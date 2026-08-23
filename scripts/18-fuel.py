#!/usr/bin/env python3
"""Extract fuel stations and motorway service areas from OSM extracts.

Fuel is the first system that can make the fastest route the wrong route.
A stop at a motorway services costs a few minutes; the same litres at a town
station costs the exit, the lights and the return. That difference is what
makes fuel route-coupled, and route-coupled is the whole point — a cost that
scales with time alone cannot change which corridor wins.

Reads the ORIGINAL extracts, not the filtered road-only ones: the road filter
drops everything that is not a highway way, fuel stations included.

OSM maps fuel both as nodes and as building polygons. Polygons are reduced to
the mean of their nodes, which is close enough for a stop location and avoids
osmium's full area machinery. Getting those node locations uses the same cursor
trick as scripts/15-filter-roads.py: refs sorted once, PBF nodes arrive in id
order, so membership is O(1) per node rather than a lookup.

Output: data/fuel.json — [lon, lat, kind] where kind is 0 fuel, 1 services.

Usage: scripts/18-fuel.py data/fuel.json a.osm.pbf b.osm.pbf ...
"""
import json
import os
import sys

import numpy as np
import osmium

FUEL, SERVICES = 0, 1


def kind_of(tags):
    if tags.get('amenity') == 'fuel':
        return FUEL
    if tags.get('highway') == 'services':
        return SERVICES
    return None


class Collect(osmium.SimpleHandler):
    """Points straight away; polygon node refs for a second pass."""

    def __init__(self):
        super().__init__()
        self.points = []          # (lon, lat, kind)
        self.areas = []           # (kind, [refs])
        self.refs = []

    def node(self, n):
        k = kind_of(n.tags)
        if k is not None:
            self.points.append((round(n.location.lon, 6), round(n.location.lat, 6), k))

    def way(self, w):
        k = kind_of(w.tags)
        if k is None or len(w.nodes) < 3:
            return
        refs = [n.ref for n in w.nodes]
        self.areas.append((k, refs))
        self.refs.extend(refs)


class Locate(osmium.SimpleHandler):
    def __init__(self, needed, out):
        super().__init__()
        self.needed = needed
        self.out = out
        self.cursor = 0

    def node(self, n):
        c, needed = self.cursor, self.needed
        end = len(needed)
        while c < end and needed[c] < n.id:
            c += 1
        self.cursor = c
        if c < end and needed[c] == n.id:
            self.out[n.id] = (n.location.lon, n.location.lat)


def main(out_path, pbfs):
    points = []
    for pbf in pbfs:
        name = os.path.basename(pbf)
        print(f'pass 1  {name}', flush=True)
        c = Collect()
        c.apply_file(pbf)
        print(f'        {len(c.points):,} point stations, {len(c.areas):,} mapped as areas', flush=True)
        points.extend(c.points)

        if c.areas:
            needed = np.unique(np.array(c.refs, dtype=np.int64))
            loc = {}
            print(f'pass 2  {name}  locating {len(needed):,} area nodes', flush=True)
            Locate(needed, loc).apply_file(pbf)
            found = 0
            for k, refs in c.areas:
                pts = [loc[r] for r in refs if r in loc]
                if not pts:
                    continue
                lon = sum(p[0] for p in pts) / len(pts)
                lat = sum(p[1] for p in pts) / len(pts)
                points.append((round(lon, 6), round(lat, 6), k))
                found += 1
            print(f'        {found:,} area centroids', flush=True)

    # Same station mapped in two files, or a node inside its own polygon, would
    # otherwise double up. ~50 m is tighter than any two real stations.
    seen, uniq = set(), []
    for lon, lat, k in points:
        key = (round(lon, 3), round(lat, 3), k)
        if key in seen:
            continue
        seen.add(key)
        uniq.append([lon, lat, k])

    with open(out_path, 'w') as fh:
        json.dump({
            'note': 'kind: 0 = amenity=fuel, 1 = highway=services',
            'sources': [os.path.basename(p) for p in pbfs],
            'stations': uniq,
        }, fh)

    fuel = sum(1 for p in uniq if p[2] == FUEL)
    print(f'\n{len(uniq):,} stations ({fuel:,} fuel, {len(uniq) - fuel:,} services)')
    print(f'{os.path.getsize(out_path) / 1048576:.1f} MB -> {out_path}')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2:])
