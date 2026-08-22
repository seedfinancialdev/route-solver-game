#!/usr/bin/env python3
"""Build a routable road graph from one or more OSM extracts.

Every road is playable, so the game needs its own graph over the real network —
not the 2,160-edge curated one, and not a public router whose cost model we do
not control. Fuel range, enforcement risk and the Google-penalty gate all need
weights we own.

Stores NO geometry. Shapes were 95% of an earlier JSON build (53 MB for
Portugal, of which 2.8 MB was the actual graph) and the router never reads them
— the map draws roads from vector tiles. Keeping them would duplicate the
entire road network for nothing.

Output is struct-of-arrays binary plus a JSON manifest:
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
import json
import os
import sys
from collections import defaultdict

import osmium

CLASSES = [
    'motorway', 'trunk', 'primary', 'secondary',
    'motorway_link', 'trunk_link', 'primary_link', 'secondary_link',
]
CLASS_ID = {c: i for i, c in enumerate(CLASSES)}
KEEP = set(CLASSES)

# Fallback when maxspeed is absent or unparseable. This fires a lot: measured
# 35.9% real coverage in Portugal, so most edges use these.
DEFAULT_KMH = {
    'motorway': 120, 'trunk': 100, 'primary': 80, 'secondary': 70,
    'motorway_link': 60, 'trunk_link': 55, 'primary_link': 50, 'secondary_link': 45,
}

FLAG_ONEWAY = 1
FLAG_TOLL = 2
FLAG_MAXSPEED_REAL = 4   # so the game can be honest about what it knows


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


class Ways(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = []
        self.use = defaultdict(int)

    def way(self, w):
        hw = w.tags.get('highway')
        if hw not in KEEP or w.tags.get('access') in ('no', 'private'):
            return
        refs = [n.ref for n in w.nodes]
        if len(refs) < 2:
            return
        kmh, real = parse_maxspeed(w.tags.get('maxspeed'), hw)
        flags = 0
        if w.tags.get('oneway') in ('yes', 'true', '1') or hw == 'motorway_link':
            flags |= FLAG_ONEWAY
        if w.tags.get('toll') == 'yes':
            flags |= FLAG_TOLL
        if real:
            flags |= FLAG_MAXSPEED_REAL
        self.ways.append((refs, CLASS_ID[hw], kmh, flags))
        for r in refs:
            self.use[r] += 1
        self.use[refs[0]] += 1
        self.use[refs[-1]] += 1


class Nodes(osmium.SimpleHandler):
    def __init__(self, wanted, out):
        super().__init__()
        self.wanted = wanted
        self.out = out

    def node(self, n):
        if n.id in self.wanted:
            self.out[n.id] = (n.location.lon, n.location.lat)


def haversine(a, b):
    from math import asin, cos, radians, sin, sqrt
    p1, p2 = radians(a[1]), radians(b[1])
    dp, dl = p2 - p1, radians(b[0] - a[0])
    h = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * 6371000 * asin(sqrt(h))


def main(out_dir, pbfs):
    os.makedirs(out_dir, exist_ok=True)
    all_ways, use, loc = [], defaultdict(int), {}

    for pbf in pbfs:
        print(f'reading {os.path.basename(pbf)}')
        w = Ways()
        w.apply_file(pbf)
        all_ways.extend(w.ways)
        for k, v in w.use.items():
            use[k] += v
        print(f'  {len(w.ways):,} ways kept')

    wanted = {r for refs, *_ in all_ways for r in refs}
    print(f'\nlocating {len(wanted):,} nodes')
    for pbf in pbfs:
        Nodes(wanted, loc).apply_file(pbf)
    print(f'  located {len(loc):,}')

    junctions = {n for n, c in use.items() if c > 1}
    print(f'  {len(junctions):,} junctions')

    # Split each way at junctions. Between junctions is one edge; the shape
    # in between contributes only its length.
    node_index, node_list = {}, []

    def idx(osm_id):
        i = node_index.get(osm_id)
        if i is None:
            i = len(node_list)
            node_index[osm_id] = i
            node_list.append(loc[osm_id])
        return i

    ea, eb, em, ek, ec, ef = (array.array('i'), array.array('i'), array.array('I'),
                              array.array('B'), array.array('B'), array.array('B'))
    real_ms = 0
    for refs, cls, kmh, flags in all_ways:
        refs = [r for r in refs if r in loc]
        if len(refs) < 2:
            continue
        start, metres = refs[0], 0.0
        for i in range(1, len(refs)):
            metres += haversine(loc[refs[i - 1]], loc[refs[i]])
            r = refs[i]
            if r in junctions or i == len(refs) - 1:
                if metres >= 1 and r != start:
                    ea.append(idx(start)); eb.append(idx(r))
                    em.append(int(round(metres)))
                    ek.append(min(255, kmh)); ec.append(cls); ef.append(flags)
                    if flags & FLAG_MAXSPEED_REAL:
                        real_ms += 1
                start, metres = r, 0.0

    nodes = array.array('f')
    for lon, lat in node_list:
        nodes.append(lon); nodes.append(lat)

    def write(name, arr):
        path = os.path.join(out_dir, name)
        with open(path, 'wb') as fh:
            arr.tofile(fh)
        return os.path.getsize(path)

    size = write('graph.nodes.bin', nodes)
    for name, arr in (('a', ea), ('b', eb), ('m', em), ('kmh', ek), ('cls', ec), ('flags', ef)):
        size += write(f'graph.edges.{name}.bin', arr)

    lons = [p[0] for p in node_list]; lats = [p[1] for p in node_list]
    meta = {
        'built': __import__('datetime').date.today().isoformat(),
        'sources': [os.path.basename(p) for p in pbfs],
        'nodes': len(node_list),
        'edges': len(ea),
        'classes': CLASSES,
        'flags': {'oneway': FLAG_ONEWAY, 'toll': FLAG_TOLL, 'maxspeedReal': FLAG_MAXSPEED_REAL},
        'bbox': [min(lons), min(lats), max(lons), max(lats)],
        'maxspeedRealPct': round(100 * real_ms / max(1, len(ea)), 1),
        'totalKm': round(sum(em) / 1000),
        'note': 'No geometry: the router does not need it and the map draws roads from vector tiles.',
    }
    with open(os.path.join(out_dir, 'graph.meta.json'), 'w') as fh:
        json.dump(meta, fh, indent=2)

    print(f'\n{meta["nodes"]:,} nodes, {meta["edges"]:,} edges, {meta["totalKm"]:,} km')
    print(f'maxspeed real on {meta["maxspeedRealPct"]}% of edges')
    print(f'binary total {size / 1048576:.1f} MB  ->  {out_dir}')
    by = defaultdict(int)
    for c in ec:
        by[CLASSES[c]] += 1
    for c, n in sorted(by.items(), key=lambda kv: -kv[1]):
        print(f'  {c:<16} {n:>8,}')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2:])
