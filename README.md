# The Gamefeel Benchmark

A creativity benchmark for AI models on game development. Each model adds content and balance changes to 12 unpublished games, and is scored on coding, gamefeel, creativity and reverse-evaluation (RE). The site shows each model's scores against its price per task.

**Open the benchmark:** https://kodasdream.github.io/gamefeel-benchmark/

## The data

The results are published as a CSV file: [`data/gamefeelbench.csv`](data/gamefeelbench.csv), one row per model and effort level. [`data/labs.csv`](data/labs.csv) maps each `lab_key` to its lab name, colour and logo.

The scores are on the **v1.4 standard**: coding scores are 15 points lower than in v1.3, and the gamefeel and creativity scores are 25 points lower. The Gamefeel RE score is not changed by the standard.

| Column | Meaning |
|---|---|
| `model`, `effort` | The model and its effort setting |
| `lab_key`, `lab` | The lab that made the model |
| `price_per_task_usd` | Price per task in US dollars. `0` means free |
| `billing` | `sub` (subscription), `api` (pay per token) or `free` |
| `context` | Context window |
| `minutes_per_task` | Time spent per task, in minutes |
| `context_compression_per_task` | How often the model summarises to fit its context window, per task |
| `tokens_per_second` | Output speed |
| `create`, `bugfix` | Coding scores, out of 100 |
| `gamefeel` | Gamefeel score, out of 100 |
| `ideas`, `visuals`, `audio` | Creativity scores, out of 100 |
| `re` | Gamefeel Reverse-Evaluation (RE), out of 100 |
| `avg` | Average of the seven scores (the six scores and `re`). The overall ranking only uses models with all seven |

A blank score means the model has no score for that subcategory.

## The tests

- **Coding, create:** add a new mechanic to a game.
- **Coding, bugfix:** find bugs planted in a game.
- **Gamefeel:** add 30 to 100 new items and balance changes to a game without breaking its balance.
- **Creativity:** the ideas, visuals and audio the model produces for the content it adds on its own.
- **Gamefeel RE (Reverse-Evaluation):** the model rates other models' results and real game changelogs. Scored on its rating error and on how well its ratings separate real changes from rejected ones.

## Preview the site on your computer

The page loads its data from files, so open it through a local server rather than by double-clicking `index.html`:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000 in a browser.

## Files

- `index.html`, `style.css`, `app.js`: the website
- `data/`: the published data (CSV and one small metadata file)
- `lab-icons/`: the lab logos, as SVG
