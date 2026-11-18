# Tenaqa Agent HQ

A private page that shows how work flows through Tenaqa's agent departments, live from the Tenaqa Pilot Trello board.

- **Flow:** you → Chief of Staff → the Build, Grow, Care and Run-the-company lanes. Tap a department for what it owns, how work moves inside it, its team, and its work (active, pending, waiting for you, completed), whole department or per agent.
- **Today:** what waits for you, the agents' next runs, what they're working on, the queue and recent activity.

## How it gets the data

`netlify/functions/board.mjs` reads the board from Trello (read-only) and serves it at `/api/board` to viewers who send the passcode. Three environment variables, set in Netlify → Site configuration → Environment variables (mark them secret):

| Variable | What |
| --- | --- |
| `TRELLO_KEY` | A Trello Power-Up API key (trello.com/power-ups/admin) |
| `TRELLO_TOKEN` | A read-only token for that key (`scope=read`) |
| `HQ_PASSCODE` | The passcode the page asks for |

Without them the page still shows the map, with no counts.

## Which department a card belongs to

1. A `Department: <name>` line in the card's description, or a Trello label named after the department (`Engineering`, `QA`, `Release`, `Marketing`, …, or its id in `org.js`).
2. Otherwise words in the card's name (rules in `org.js`, `match`).

An agent is named by an `Agent: <name>` line in the card's description.

## Changing the map

Everything about departments, people, workflows, lanes and the run schedule is in `org.js`.
