# The GameFeel Benchmark

A creativity benchmark for AI models on game development focusing on understanding game balancing and complex features. Each model adds content and balance changes to 12 unpublished games, and is scored on coding, gamefeel, creativity and reverse-evaluation (RE). The site shows each model's scores against its price per task, and the open-weight models with a stated size.

**Open the benchmark:** [https://kodasdream.github.io/gamefeel-benchmark/](https://kodasdream.github.io/gamefeel-benchmark/)

## How the benchmark works

### The games

The benchmark currently uses 12 game projects, three from each of four genres:

| Genre                  | Games |
|------------------------|-------|
| Roguelikes             | 3     |
| MMORPGs                | 3     |
| Single-player RPGs     | 3     |
| Survival and/or sandbox| 3     |

All 12 are real game development projects that were never published, so no model can have seen them in its training data.

### Structure

Every game is tested in all 7 subcategories, which gives **7 × 12 = 84 subcategory-game pairings** and a total of about **60,000 tasks**.

| Group      | Subcategory                       | How it is graded                  |
|------------|-----------------------------------|-----------------------------------|
| Coding     | Create                            | Answer key, checked by Opus 5.5   |
| Coding     | Debugging                         | Answer key, checked by Opus 5.5   |
| Gamefeel   | Gamefeel                          | Human evaluation                  |
| Creativity | Ideas                             | Human evaluation                  |
| Creativity | Visuals                           | Human evaluation                  |
| Creativity | Audio                             | Human evaluation                  |
| Gamefeel   | Reverse-Evaluation (RE)           | Answer key, checked by Opus 5.5   |

### What each subcategory measures

**Coding – Create:** how well a model can code a new mechanic into a game when prompted to.

**Coding – Debugging:** how well a model can find bugs that were intentionally planted in the projects.

**Gamefeel:** how well a model can add new content or balance changes to a game without breaking its balance.

For the gamefeel and creativity tests, models are told to add 30 to 100 new items, mechanics and balance changes to each game. They are not told what these changes should be. Instead, they have to base their suggestions on deep-diving into the project, playtesting it themselves, or writing bots that play it for them.

**Creativity – Ideas:** how creative and original the ideas are when models add new content to the games on their own.

**Creativity – Visuals:** how good the visuals are for the content models add on their own.

**Creativity – Audio:** how good the sound effects and soundtracks are for the content models add.

**Gamefeel – Reverse-Evaluation (RE):** the model rates the results of other AI models as well as real game development changelogs. It is scored on its mean rating error, and on the score drift / separation between the two categories.

### How it is graded

**Answer-key subcategories (Coding – Create, Coding – Debugging).** Each answer is compared with an answer key. Opus 5.5 checks whether a mismatch is only a formatting error or a near miss, and decides whether the answer is accepted.

**Reverse-Evaluation (RE).** Uses ground-truth answer keys with the formula 

`((fsep * max(0, (AUC - 0.5) * 2)) / max(1, sqrt(MAE))) * L2.5 * M`

where `M` is `1.5` on the regular subsections and `1` on the Hard subsection.

> *Formula terms:* `fsep` = folded separation ratio between high- and low-rated items relative to the ground-truth gap (penalizing both under- and over-separation); `AUC` = area under the ROC curve for ranking higher-rated items above lower-rated ones; `MAE` = mean absolute rating error against the answer key; `L2.5` = power-mean accuracy (`p = 2.5`) that penalizes large rating misses more heavily than small ones.

**Human-evaluated subcategories (Gamefeel, Ideas, Visuals, Audio).** Each of these has about 800 tasks per subcategory per game (about 38,400 human-rated tasks in total). Every task is scored individually from 1 to 10 by a human evaluator, and the average of those scores is the result for that subcategory on that game. Averages are multiplied by 10 to give the score out of 100 used in the data, so an average of 5.43 becomes 54.3.

## The data

The results are published as a CSV file: [`data/gamefeelbench.csv`](data/gamefeelbench.csv), one row per model and effort level. [`data/labs.csv`](data/labs.csv) maps each `lab_key` to its lab name, colour and logo.


| Column                         | Meaning |
|--------------------------------|---------|
| `model`, `effort`              | The model and its effort setting |
| `lab_key`, `lab`               | The lab that made the model |
| `price_per_task_usd`           | Price per task in US dollars. `0` means free. Blank when the price is not known |
| `billing`                      | `sub` (subscription), `api` (pay per token) or `free` |
| `context`                      | Context window |
| `minutes_per_task`             | Time spent per task, in minutes. Blank when not known |
| `context_compression_per_task` | How often the model summarises to fit its context window, per task |
| `tokens_per_second`            | Output speed. Blank when not known |
| `create`, `bugfix`             | Coding scores, out of 100 (`bugfix` is the Debugging subcategory; the column keeps its old name) |
| `gamefeel`                     | Gamefeel score, out of 100 |
| `ideas`, `visuals`, `audio`    | Creativity scores, out of 100 |
| `re_blind`, `re_assisted`, `re_released` | Gamefeel Reverse-Evaluation (RE) parts, out of 100: blind, assisted (39 rated examples first), and released-blind (released commercial games such as Balatro, Slay the Spire, World of Warcraft) |
| `re_combined`                  | RE combined (v1.5.2): (5 × `re_blind` + 2 × `re_blind_hard` + 3 × `re_assisted` + 1 × `re_assisted_hard` + 2 × `re_released`) ÷ 13. A part a model has not run is estimated from the parts it has, using each part's typical size relative to blind across the models that have both (the factors are in `data/meta.json`), so a partial record is not scored down for the parts it is missing |
| `avg`                          | Overall (v1.5.1 and later): weighted average of the six scores (weight 1 each) and `re_combined` (weight 1.5), divided by 7.5. Blank unless all seven are in. The overall ranking only uses models with all seven |
| `open_weights`                 | `yes` or `no`: whether the model's weights are open. Blank when not known |
| `size_gb`                      | Model size in GB, for open-weight models where known. Blank when not known |
| `size_basis`                   | The quantization the size is for, where stated |
| `re_test`                      | A note when the RE score is from the semi-private subset of the RE test (748 tasks). Every other result is the full test, over 8,000 tasks. Blank for the full test |
| `aa_index`                     | Artificial Analysis Intelligence Index (artificialanalysis.ai, read 2026-11-13) for the same model and reasoning effort. Blank when the model is not on their leaderboard |
| `gci`                          | Gamefeel Capabilities Index: comparable across benchmark versions. On v1.5 it equals `avg`; later versions (v1.5.2 now) are mapped onto it through models tested in both. History in `data/gci-history.csv` |
| `release_date`                 | The model's public release date (YYYY-MM-DD); blank for unreleased or stealth models, which get no GCI |
| `re_blind_hard`, `re_assisted_hard` | RE hard: the blind and assisted runs scored only on the cards the designers rated by hand, at 1x (no 1.5x multiplier) |

A blank score means the model has no score for that subcategory.

## Preview the site on your computer

The page loads its data from files, so open it through a local server rather than by double-clicking `index.html`:

```
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000) in a browser.

## Files

- `index.html`, `style.css`, `app.js`: the website
- `data/`: the published data (CSV and one small metadata file)
- `lab-icons/`: the lab logos, as SVG
