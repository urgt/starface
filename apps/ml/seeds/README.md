# Seeds

Place celebrity photos and a manifest CSV here for bulk enrollment.

## Manifest format (`celebrities.csv`)

| column | required | notes |
| --- | --- | --- |
| `name` | ✓ | Latin/Uzbek spelling |
| `name_ru` | | Cyrillic name |
| `category` | | `uz`, `cis`, or `world` |
| `description_uz` | | Short bio |
| `description_ru` | | Short bio |
| `photo` | ✓ | Path to a single-face photo (absolute, or relative to this CSV) |

## Run

```bash
# From repo root, with DATABASE_URL set and ML models downloaded:
pnpm enroll --manifest apps/ml/seeds/celebrities.csv

# Folder mode (category = folder name, file name = celebrity name):
python -m app.enroll --folder apps/ml/seeds/photos/uz --category uz
```

## Photo requirements

- Single frontal face per image
- ≥ 256×256 px recommended
- JPG/PNG/WEBP
- Clean background preferred (e.g. press photos, official portraits)
