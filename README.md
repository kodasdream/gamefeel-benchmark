# The GameFeel Benchmark

A creativity benchmark for AI models on game development focusing on understanding game balancing and complex features interacting with each other. Each model adds content and balance changes to 12 unpublished games, and is scored on coding, gamefeel, creativity and reverse-evaluation (RE). The site shows each model's scores against its price per task, and the open-weight models with a stated size.

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
| Coding     | Bugfix / Debugging                | Answer key, checked by Opus 5.5   |
| Gamefeel   | Gamefeel                          | Human evaluation                  |
| Creativity | Ideas                             | Human evaluation                  |
| Creativity | Visuals                           | Human evaluation                  |
| Creativity | Audio                             | Human evaluation                  |
| Gamefeel   | Reverse-Evaluation (RE)           | Answer key, checked by Opus 5.5   |

### What each subcategory measures

**Coding – Create:** how well a model can code a new mechanic into a game when prompted to.

**Coding – Bugfix / Debugging:** how well a model can find bugs that were intentionally planted in the projects.

**Gamefeel:** how well a model can add new content or balance changes to a game without breaking its balance.

For the gamefeel and creativity tests, models are told to add 30 to 100 new items, mechanics and balance changes to each game. They are not told what these changes should be. Instead, they have to base their suggestions on deep-diving into the project, playtesting it themselves, or writing bots that play it for them.

**Creativity – Ideas:** how creative and original the ideas are when models add new content to the games on their own.

**Creativity – Visuals:** how good the visuals are for the content models add on their own.

**Creativity – Audio:** how good the sound effects and soundtracks are for the content models add.

**Gamefeel – Reverse-Evaluation (RE):** the model rates the results of other AI models as well as real game development changelogs. It is scored on its mean rating error, and on the score drift / separation between the two categories.

### How it is graded

**Answer-key subcategories (Coding – Create, Coding – Bugfix / Debugging, RE).** Each answer is compared with an answer key. Opus 5.5 checks whether a mismatch is only a formatting error or a near miss, and decides whether the answer is accepted.

**Human-evaluated subcategories (Gamefeel, Ideas, Visuals, Audio).** Each of these has about 800 tasks per subcategory per game (about 38,400 human-rated tasks in total). Every task is scored individually from 1 to 10 by a human evaluator, and the average of those scores is the result for that subcategory on that game. Averages are multiplied by 10 to give the score out of 100 used in the data, so an average of 5.43 becomes 54.3.

## The data

The results are published as a CSV file: [`data/gamefeelbench.csv`](data/gamefeelbench.csv), one row per model and effort level. [`data/labs.csv`](data/labs.csv) maps each `lab_key` to its lab name, colour and logo.


| Column                         | Meaning |
|--------------------------------|---------|
| `model`, `effort`              | The model and its effort setting |
| `lab_key`, `lab`               | The lab that made the model |
| `price_per_task_usd`           | Price per task in US dollars. `0` means free |
| `billing`                      | `sub` (subscription), `api` (pay per token) or `free` |
| `context`                      | Context window |
| `minutes_per_task`             | Time spent per task, in minutes |
| `context_compression_per_task` | How often the model summarises to fit its context window, per task |
| `tokens_per_second`            | Output speed |
| `create`, `bugfix`             | Coding scores, out of 100 |
| `gamefeel`                     | Gamefeel score, out of 100 |
| `ideas`, `visuals`, `audio`    | Creativity scores, out of 100 |
| `re`                           | Gamefeel Reverse-Evaluation (RE), out of 100 |
| `avg`                          | Average of the seven scores (the six scores and `re`). The overall ranking only uses models with all seven |
| `open_weights`                 | `yes` or `no`: whether the model's weights are open. Blank when not known |
| `size_gb`                      | Model size in GB, for open-weight models where known. Blank when not known |
| `size_basis`                   | The quantization the size is for, where stated |

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
