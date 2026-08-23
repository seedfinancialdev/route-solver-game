#!/usr/bin/env python3
"""Reduce an OSM extract to just the roads a long-distance run can use.

Why this exists: scripts/14-road-graph.py needs node locations, and osmium's
location index stores a location for EVERY node in the file, not just the ones
on roads. Measured on Iberia, that index was 3.58 GB for 1.76 GB of input —
roughly 2x the extract — which projects to ~66 GB for Europe.

Roads are a small fraction of OSM. Filtering first turns that index from a
continental-scale problem into a small one, and the filtered file is cached, so
adding a country later costs filtering that one country rather than redoing
anything.

Two passes:
  1. collect the node ids referenced by kept ways
  2. write out those nodes, then the kept ways

The membership test in pass 2 walks a sorted array with a moving cursor rather
than doing a lookup per node. PBF stores nodes in ascending id order, so that
is O(1) per node — a set of a few hundred million ids would not fit, and a
binary search per node would dominate the runtime.

Usage:
  scripts/15-filter-roads.py in.osm.pbf out.osm.pbf
"""
import os
import sys

import numpy as np
import osmium

# Every road a car can drive, except `service`.
# A spine of motorway-to-secondary is not enough. The last kilometres of a run
# are real time — tens of minutes in a dense city — and a fuel detour has to be
# ROUTED, not estimated: a station 500 m away as the crow flies can be 4 km by
# road, on the wrong side of a dual carriageway with no junction. Straight-line
# detour costs were tried and are not close.
#
# `service` is excluded: 21% of all drivable ways and almost entirely parking
# aisles and driveways. The cost of that is the last ~50 m onto a forecourt,
# which is seconds, not the kilometres the spine-only version was fudging.
KEEP = {
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
    'unclassified', 'residential', 'living_street',
    'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
}

def wanted(tags):
    hw = tags.get('highway')
    if hw not in KEEP or tags.get('access') in ('no', 'private'):
        return None
    return hw



class CollectRefs(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.refs = []
        self.chunks = []
        self.ways = 0

    def way(self, w):
        if len(w.nodes) < 2 or not wanted(w.tags):
            return
        self.ways += 1
        self.refs.extend(n.ref for n in w.nodes)
        if len(self.refs) > 8_000_000:      # flush so the Python list stays small
            self.chunks.append(np.array(self.refs, dtype=np.int64))
            self.refs = []

    def finish(self):
        if self.refs:
            self.chunks.append(np.array(self.refs, dtype=np.int64))
            self.refs = []
        if not self.chunks:
            return np.empty(0, dtype=np.int64)
        return np.unique(np.concatenate(self.chunks))


class Writer(osmium.SimpleHandler):
    """Writes the wanted nodes, then the wanted ways.

    `needed` is sorted and PBF nodes arrive in ascending id order, so a cursor
    is enough — no per-node lookup.
    """

    def __init__(self, needed, writer):
        super().__init__()
        self.needed = needed
        self.w = writer
        self.cursor = 0
        self.nodes_out = 0
        self.ways_out = 0

    def node(self, n):
        c, needed = self.cursor, self.needed
        end = len(needed)
        while c < end and needed[c] < n.id:
            c += 1
        self.cursor = c
        if c < end and needed[c] == n.id:
            self.w.add_node(n)
            self.nodes_out += 1

    def way(self, w):
        if len(w.nodes) >= 2 and wanted(w.tags):
            self.w.add_way(w)
            self.ways_out += 1


def main(src, dst):
    if os.path.exists(dst):
        print(f'{os.path.basename(dst)} already built, skipping')
        return

    print(f'pass 1  {os.path.basename(src)}', flush=True)
    c = CollectRefs()
    c.apply_file(src)
    needed = c.finish()
    print(f'        {c.ways:,} road ways, {len(needed):,} distinct nodes', flush=True)

    # osmium detects the format from the extension, so the partial file has to
    # keep it — a plain '.partial' suffix fails outright.
    tmp = dst.replace('.osm.pbf', '.partial.osm.pbf')
    if os.path.exists(tmp):
        os.remove(tmp)
    print('pass 2  writing', flush=True)
    writer = osmium.SimpleWriter(tmp)
    h = Writer(needed, writer)
    h.apply_file(src)
    writer.close()
    os.rename(tmp, dst)

    before = os.path.getsize(src) / 1048576
    after = os.path.getsize(dst) / 1048576
    print(f'        {h.nodes_out:,} nodes, {h.ways_out:,} ways')
    print(f'        {before:,.0f} MB -> {after:,.0f} MB  ({100 * after / before:.1f}%)')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
