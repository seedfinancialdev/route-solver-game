#!/usr/bin/env python3
"""Build a routable road graph from one or more OSM extracts.

Every road is playable, so the game needs its own graph over the real network —
not the 2,160-edge curated one, and not a public router whose cost model we do
not control. Fuel range, enforcement risk and the Google-penalty gate all need
weights we own.

Stores NO geometry. Shapes were 95% of an earlier JSON build (53 MB for
Portugal, of which 2.8 MB was the actual graph) and the router never reads them
— the map draws roads from vector tiles.

MEMORY. A dict of node id -> location is fine for Iberia's 4.5 M nodes and
impossible for Europe's ~80 M. Neither that dict nor a usage-count dict exists
here:

  * locations come from osmium's disk-backed sparse_file_array index, so the
    process holds a few hundred MB regardless of extract size;
  * junction detection sorts an int64 numpy array in place. A Python
    `sorted()` over the same data materialises one boxed int per reference —
    that alone took 4.1 GB of peak RSS on Iberia and would be tens of GB on
    Europe;
  * the sorted junction array IS the node numbering — position in it is the
    graph node id — so there is no id-mapping dict either.

Three passes over the PBF, which is I/O the OS caches, in exchange for flat
memory.

Output: struct-of-arrays binary plus a JSON manifest.
  graph.meta.json   counts, bbox, class enum, provenance
  graph.nodes.bin   Float32 [lon, lat] * N
  graph.edges.bin   Int32 a[], Int32 b[], Uint32 metres[], Uint8 kmh[],
                    Uint8 cls[], Uint8 flags[]

OSM node ids are global, so extracts merge on id with no seam handling.

Usage:
  scripts/14-road-graph.py data/road-graph a.osm.pbf b.osm.pbf ...

Needs pyosmium:  python3 -m venv /tmp/osmenv && /tmp/osmenv/bin/pip install osmium
"""
import array
import bisect
import json
import os
import sys
import tempfile
from collections import defaultdict
from math import asin, cos, radians, sin, sqrt

import numpy as np
import osmium

CLASSES = [
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
    'unclassified', 'residential', 'living_street',
    'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
]
CLASS_ID = {c: i for i, c in enumerate(CLASSES)}
KEEP = set(CLASSES)

# Fallback when maxspeed is absent or unparseable. This fires a lot: 42.5% real
# in the Iberian build, so most edges use these.
DEFAULT_KMH = {
    'motorway': 120, 'trunk': 100, 'primary': 80, 'secondary': 70, 'tertiary': 60,
    'unclassified': 50, 'residential': 30, 'living_street': 15,
    'motorway_link': 60, 'trunk_link': 55, 'primary_link': 50, 'secondary_link': 45,
    'tertiary_link': 40,
}

FLAG_ONEWAY = 1
FLAG_TOLL = 2
FLAG_MAXSPEED_REAL = 4   # so the game can be honest about what it knows


def wanted(tags):
    hw = tags.get('highway')
    if hw not in KEEP or tags.get('access') in ('no', 'private'):
        return None
    return hw


def parse_maxspeed(value, highway):
    if not value:
        return DEFAULT_KMH.get(highway, 60), False
    v = value.strip().lower()
    if v in ('none', 'unlimited'):
        return 150, True          # derestricted autobahn, at real planning speed
    if v.startswith('walk'):
        return 7, True
    try:
        if v.endswith('mph'):
            return round(float(v[:-3].strip()) * 1.60934), True
        return int(float(v.split()[0])), True
    except (ValueError, IndexError):
        return DEFAULT_KMH.get(highway, 60), False


def haversine(lon1, lat1, lon2, lat2):
    p1, p2 = radians(lat1), radians(lat2)
    dp, dl = p2 - p1, radians(lon2 - lon1)
    h = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * 6371000 * asin(sqrt(h))


class CountRefs(osmium.SimpleHandler):
    """Pass 1: every node reference of every kept way, plus the endpoints.

    An int64 array rather than a Counter: 8 bytes a reference instead of the
    ~60 a dict entry costs, which is the difference between fitting Europe in
    memory and not.
    """

    def __init__(self, refs, ends):
        super().__init__()
        self.refs = refs
        self.ends = ends
        self.kept = 0

    def way(self, w):
        if not wanted(w.tags):
            return
        nodes = w.nodes
        if len(nodes) < 2:
            return
        self.kept += 1
        for n in nodes:
            self.refs.append(n.ref)
        # A way's first and last node are junctions by definition, even if no
        # other way touches them — they are where this edge has to terminate.
        self.ends.append(nodes[0].ref)
        self.ends.append(nodes[-1].ref)


class Build(osmium.SimpleHandler):
    """Pass 3: split each way at junctions and emit edges.

    Locations arrive already attached to w.nodes because a
    NodeLocationsForWays handler runs ahead of this one, reading from the
    on-disk index built in pass 2.
    """

    def __init__(self, junctions, node_xy, out):
        super().__init__()
        self.j = junctions          # sorted array of junction node ids
        self.xy = node_xy           # Float32 array, 2 per junction, filled here
        self.out = out
        self.real_ms = 0
        self.dropped = 0

    def index_of(self, node_id):
        i = bisect.bisect_left(self.j, node_id)
        return i if i < len(self.j) and self.j[i] == node_id else -1

    def way(self, w):
        hw = wanted(w.tags)
        if not hw:
            return
        kmh, real = parse_maxspeed(w.tags.get('maxspeed'), hw)
        flags = 0
        if w.tags.get('oneway') in ('yes', 'true', '1') or hw == 'motorway_link':
            flags |= FLAG_ONEWAY
        if w.tags.get('toll') == 'yes':
            flags |= FLAG_TOLL
        if real:
            flags |= FLAG_MAXSPEED_REAL
        cls = CLASS_ID[hw]

        ea, eb, em, ek, ec, ef = self.out
        start_idx, prev_lon, prev_lat, metres = -1, None, None, 0.0

        for n in w.nodes:
            if not n.location.valid():
                self.dropped += 1
                continue
            lon, lat = n.location.lon, n.location.lat
            if prev_lon is not None:
                metres += haversine(prev_lon, prev_lat, lon, lat)
            prev_lon, prev_lat = lon, lat

            idx = self.index_of(n.ref)
            if idx < 0:
                continue                      # shape point between junctions
            self.xy[2 * idx] = lon
            self.xy[2 * idx + 1] = lat
            if start_idx < 0:
                start_idx, metres = idx, 0.0
                continue
            if metres >= 1 and idx != start_idx:
                ea.append(start_idx); eb.append(idx)
                em.append(int(round(metres)))
                ek.append(min(255, kmh)); ec.append(cls); ef.append(flags)
                if real:
                    self.real_ms += 1
            start_idx, metres = idx, 0.0


def main(out_dir, pbfs):
    os.makedirs(out_dir, exist_ok=True)
    refs, ends = array.array('q'), array.array('q')

    for pbf in pbfs:
        print(f'pass 1  {os.path.basename(pbf)}', flush=True)
        c = CountRefs(refs, ends)
        c.apply_file(pbf)
        print(f'        {c.kept:,} ways kept, {len(refs):,} refs so far', flush=True)

    print(f'\nfinding junctions in {len(refs):,} references', flush=True)
    # numpy throughout: every one of these steps in pure Python materialises a
    # boxed int per reference, which is what made this the memory ceiling.
    a = np.frombuffer(refs, dtype=np.int64)
    del refs
    a = np.sort(a)
    shared = a[:-1][a[1:] == a[:-1]]           # referenced more than once
    e = np.frombuffer(ends, dtype=np.int64)
    del ends
    junc = np.unique(np.concatenate([shared, e]))
    del a, shared, e
    junctions = array.array('q', junc.tobytes())
    del junc
    print(f'  {len(junctions):,} junction nodes', flush=True)

    node_xy = array.array('f', [0.0]) * 0
    node_xy = array.array('f', bytes(8 * len(junctions)))

    idx_dir = tempfile.mkdtemp(prefix='osm-node-idx-')
    idx_path = os.path.join(idx_dir, 'nodes.idx')
    out = (array.array('i'), array.array('i'), array.array('I'),
           array.array('B'), array.array('B'), array.array('B'))
    builder = Build(junctions, node_xy, out)

    # One index across every extract, not one per file: a way near a border
    # references nodes that live in the neighbouring country's extract, and a
    # per-file index would silently drop exactly the cross-border edges a
    # continental run depends on.
    idx = osmium.index.create_map(f'sparse_file_array,{idx_path}')
    locations = osmium.NodeLocationsForWays(idx)
    locations.ignore_errors()
    try:
        for pbf in pbfs:
            print(f'pass 2+3  {os.path.basename(pbf)}  (locations on disk)', flush=True)
            osmium.apply(osmium.io.Reader(pbf), locations, builder)
            sz = os.path.getsize(idx_path) if os.path.exists(idx_path) else 0
            print(f'        {len(out[0]):,} edges so far, node index {sz/1073741824:.2f} GB on disk', flush=True)
    finally:
        if os.path.exists(idx_path):
            os.remove(idx_path)
        os.rmdir(idx_dir)

    ea, eb, em, ek, ec, ef = out

    def write(name, arr):
        path = os.path.join(out_dir, name)
        with open(path, 'wb') as fh:
            arr.tofile(fh)
        return os.path.getsize(path)

    size = write('graph.nodes.bin', node_xy)
    for name, arr in (('a', ea), ('b', eb), ('m', em), ('kmh', ek), ('cls', ec), ('flags', ef)):
        size += write(f'graph.edges.{name}.bin', arr)

    lons = [node_xy[2 * i] for i in range(len(junctions)) if node_xy[2 * i]]
    lats = [node_xy[2 * i + 1] for i in range(len(junctions)) if node_xy[2 * i + 1]]
    meta = {
        'built': __import__('datetime').date.today().isoformat(),
        'sources': [os.path.basename(p) for p in pbfs],
        'nodes': len(junctions),
        'edges': len(ea),
        'classes': CLASSES,
        'flags': {'oneway': FLAG_ONEWAY, 'toll': FLAG_TOLL, 'maxspeedReal': FLAG_MAXSPEED_REAL},
        'bbox': [min(lons), min(lats), max(lons), max(lats)] if lons else None,
        'maxspeedRealPct': round(100 * builder.real_ms / max(1, len(ea)), 1),
        'totalKm': round(sum(em) / 1000),
        'note': 'No geometry: the router does not need it and the map draws roads from vector tiles.',
    }
    with open(os.path.join(out_dir, 'graph.meta.json'), 'w') as fh:
        json.dump(meta, fh, indent=2)

    print(f'\n{meta["nodes"]:,} nodes, {meta["edges"]:,} edges, {meta["totalKm"]:,} km')
    print(f'maxspeed real on {meta["maxspeedRealPct"]}% of edges')
    if builder.dropped:
        print(f'{builder.dropped:,} way nodes had no location and were skipped')
    print(f'binary total {size / 1048576:.1f} MB  ->  {out_dir}')
    by = defaultdict(int)
    for c in ec:
        by[CLASSES[c]] += 1
    for c, n in sorted(by.items(), key=lambda kv: -kv[1]):
        print(f'  {c:<16} {n:>9,}')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2:])
