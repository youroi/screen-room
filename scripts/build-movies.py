"""Publish the Movies catalogue as popularity-ordered result shards."""

import argparse
import csv
from datetime import date, datetime, timezone
import gzip
import json
import math
from pathlib import Path
import re

PAGE_SIZE = 18
PAGES_PER_SHARD = 12
RECORDS_PER_SHARD = PAGE_SIZE * PAGES_PER_SHARD
COUNTRIES = {
    "United States of America": "US", "United States": "US", "India": "IN",
    "South Korea": "KR", "Republic of Korea": "KR", "Korea, Republic of": "KR", "Japan": "JP",
}
GENRES = {
    "Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family",
    "Fantasy", "History", "Horror", "Music", "Mystery", "Romance", "Science Fiction",
    "TV Movie", "Thriller", "War", "Western",
}
IMDB = re.compile(r"tt\d{5,12}", re.ASCII)
POSTER = re.compile(r"/[\w-]+\.(?:jpg|jpeg|png|webp)", re.IGNORECASE | re.ASCII)


def production_codes(value):
    # The bulk source separates full production country names with commas.
    return {COUNTRIES[name.strip()] for name in value.replace("Korea, Republic of", "Republic of Korea").split(",")
            if name.strip() in COUNTRIES}


def score(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else 0
    except (ValueError, TypeError):
        return 0


def released_on(value, today):
    try:
        return value if date.fromisoformat(value).isoformat() == value and value <= today else None
    except (TypeError, ValueError):
        return None


def movie(id, imdb, title, released, poster, countries, genres, popularity, today):
    released = released_on(released, today)
    title = title.strip()
    if not id or not imdb or not IMDB.fullmatch(imdb) or not title or not released:
        return None
    return (int(id), score(popularity), sorted(set(countries) & set(COUNTRIES.values())),
            sorted(set(genres) & GENRES),
            [imdb, title[:280], released[:4], poster if POSTER.fullmatch(poster or "") else None])


def read_movies(source, recent, today):
    items = {}
    with source.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            if (row.get("adult", "").lower(), row.get("status")) != ("false", "Released"):
                continue
            item = movie(row["id"], row["imdb_id"], row["title"], row["release_date"], row["poster_path"],
                         production_codes(row["production_countries"]), row["genres"].split(", "),
                         row["popularity"], today)
            if item:
                items[item[0]] = item
    if recent:
        for entry in json.loads(recent.read_text())["items"]:
            item = movie(entry["id"], entry["imdb"], entry["title"], entry["released"], entry["poster"],
                         entry["countries"], entry["genres"], entry["popularity"], today)
            if item:
                items[item[0]] = item
    return items


def rank_movies(items, exports):
    scores = {}
    with gzip.open(exports, "rt", encoding="utf-8") as handle:
        for line in handle:
            entry = json.loads(line)
            id = entry["id"]
            if id in items:
                if entry.get("adult") is True or entry.get("video") is True:
                    items.pop(id)
                else:
                    scores[id] = score(entry.get("popularity"))

    order = sorted(items.values(), key=lambda item: (-scores.get(item[0], item[1]), item[0]))
    seen = set()
    for item in order:
        imdb = item[-1][0]
        if imdb not in seen:
            seen.add(imdb)
            yield item


def slug(genre):
    return genre.lower().replace(" ", "-")


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def publish(items, target, revision):
    groups = {}
    for _, _, countries, genres, card in items:
        for country in ("all", *countries):
            for genre in ("all", *genres):
                groups.setdefault((country, slug(genre)), []).append(card)

    counts = {}
    for (country, genre), cards in groups.items():
        counts[f"{country}/{genre}"] = len(cards)
        directory = target / country / genre
        directory.mkdir(parents=True)
        for offset in range(0, len(cards), RECORDS_PER_SHARD):
            write_json(directory / f"{offset // RECORDS_PER_SHARD}.json",
                       {"revision": revision, "items": cards[offset:offset + RECORDS_PER_SHARD]})

    write_json(target / "index.json", {
        "version": 1, "revision": revision, "pagesPerShard": PAGES_PER_SHARD, "counts": counts
    })
    return counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("exports", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--recent", type=Path)
    parser.add_argument("--min-movies", type=int, default=100000)
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    items = read_movies(args.source, args.recent, now.date().isoformat())
    if len(items) < args.min_movies:
        raise SystemExit("Movies source did not meet the minimum catalogue coverage.")
    counts = publish(rank_movies(items, args.exports), args.target, now.strftime("%Y%m%dT%H%M%SZ"))
    if counts.get("all/all", 0) < args.min_movies:
        raise SystemExit("Movies index did not meet the minimum catalogue coverage.")
    print("Movies indexed:", {key: value for key, value in counts.items() if key.endswith("/all")})


if __name__ == "__main__":
    main()
