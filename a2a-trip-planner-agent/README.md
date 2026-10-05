# Trip Planning Agent

A sample [A2A](https://a2a-protocol.org/) agent for trying out agent proxies.
It searches flights and hotels, books them, and plans an itinerary: enough of a
real workflow to be worth proxying, with nothing to configure and nothing to
pay for.

## Commands

The agent picks a skill from the first word of your message.

| Send | Get back |
|---|---|
| `flights <from> <to>` | three flights with times and fares |
| `hotels <city>` | three hotels with ratings and nightly rates |
| `book <id>` | a confirmation with a booking reference |
| `itinerary <city> <days>` | a day by day plan, streamed one day at a time |
| anything else | the list above |

Commands are case insensitive. Results are derived from the search terms, so
the same query always returns the same flights, hotels and references.

`itinerary` streams, so it is the one to use when testing
`SendStreamingMessage` or cancelling a task part-way through.

### A worked example

```
flights LHR CMB
  Flights LHR → CMB
    UL390  11:30 → 20:30     USD 970
    EK567  13:45 → 00:45+1   USD 587
    QR744  15:00 → 18:00     USD 884

book UL390
  Flight UL390 booked. Reference TP-4D1209.
  Check-in opens 24 hours before departure.

hotels Colombo
  Hotels in Colombo
    grand-colombo    Grand Colombo    ★★★★★  USD 129/night
    harbour-colombo  Harbour Colombo  ★★★    USD 262/night
    garden-colombo   Garden Colombo   ★★★★   USD 155/night

book grand-colombo
  Grand Colombo booked. Reference TP-E1D668.
  Free cancellation until 48 hours before arrival.

itinerary Colombo 3
  Day 1 in Colombo: the street food district, then a day trip along the coast.
  Day 2 in Colombo: a walking tour of the old town, then the museum of local history.
  Day 3 in Colombo: lunch at the harbour market, then the botanical gardens.
```

## Running it

```bash
npm install
npm run build
npm start
```

The Agent Card is then at `http://localhost:3001/.well-known/agent-card.json`.

### Environment

| Variable | Default | Why |
|---|---|---|
| `PORT` | `3001` | Listener port |
| `PUBLIC_BASE_URL` | `http://localhost:$PORT` | The urls written into the Agent Card |

**`PUBLIC_BASE_URL` must be set to the deployed url**, or the card advertises
`localhost` and no client can reach the transports.

## Calling it

A2A 1.0 requires an `A2A-Version` header. Without it the server assumes `0.3`
and rejects the call. Method names in 1.0 are PascalCase.

```bash
# JSON-RPC
curl -X POST http://localhost:3001/rpc \
  -H 'Content-Type: application/json' -H 'A2A-Version: 1.0' \
  -d '{"jsonrpc":"2.0","id":"1","method":"SendMessage","params":{"message":
       {"messageId":"m1","role":"ROLE_USER","parts":[{"text":"flights LHR CMB"}]}}}'

# HTTP+JSON
curl -X POST http://localhost:3001/rest/message:send \
  -H 'Content-Type: application/json' -H 'A2A-Version: 1.0' \
  -d '{"message":{"messageId":"m2","role":"ROLE_USER","parts":[{"text":"hotels Colombo"}]}}'
```

## What it supports

Four operations, over both the JSONRPC and HTTP+JSON bindings:

| Operation | JSON-RPC method | HTTP+JSON |
|---|---|---|
| SendMessage | `SendMessage` | `POST /rest/message:send` |
| SendStreamingMessage | `SendStreamingMessage` | `POST /rest/message:stream` |
| GetTask | `GetTask` | `GET /rest/tasks/{id}` |
| CancelTask | `CancelTask` | `POST /rest/tasks/{id}:cancel` |

The Agent Card advertises exactly these. It does not advertise the push
notification config operations, `ListTasks`, `SubscribeToTask` or
`GetExtendedAgentCard`, because a gateway generates a route per advertised
capability and a route the agent cannot serve is worse than no route.

## Deployment

`.choreo/component.yaml` and the stub `openapi.yaml` describe the component for
Choreo. The OpenAPI file exists to satisfy Choreo's `schemaFilePath`; it is not
a description of the A2A protocol.

**Run a single replica.** Task state is held in memory, so `GetTask` against a
second replica would miss a task the first one created.

**Tasks are cleared hourly.** The SDK's in-memory store never evicts, so the
agent replaces it on a timer rather than growing until the container runs out
of memory. A task survives up to an hour, not a guaranteed hour.

**The agent is public and unauthenticated.** Anyone who can reach it can call
every operation the SDK implements, including ones the Agent Card does not
advertise, and all callers share one task bucket. Access control belongs to
the gateway in front of it, not here.
