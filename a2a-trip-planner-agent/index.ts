import express from 'express';
import { DefaultRequestHandler } from '@a2a-js/sdk/server';
import { UserBuilder, jsonRpcHandler, restHandler } from '@a2a-js/sdk/server/express';
import { buildAgentCard } from './card.ts';
import { ExpiringTaskStore } from './taskStore.ts';
import { TripPlannerExecutor } from './executor.ts';

const PORT = Number(process.env.PORT ?? 3001);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`;

const agentCard = buildAgentCard(PUBLIC_BASE_URL);

const requestHandler = new DefaultRequestHandler(
  agentCard,
  new ExpiringTaskStore(),
  new TripPlannerExecutor()
);

const app = express();

// The A2A discovery path. The platform appends it to any upstream url that
// does not already end .json, so the card has to be reachable here.
app.get('/.well-known/agent-card.json', (_req, res) => {
  res.json(agentCard);
});

// The agent is a public sample: every caller is unauthenticated, and the
// gateway in front of it is what applies real policy.
const userBuilder = UserBuilder.noAuthentication;

app.use('/rpc', jsonRpcHandler({ requestHandler, userBuilder }));
app.use('/rest', restHandler({ requestHandler, userBuilder }));

app.listen(PORT, () => {
  console.log(
    `Trip Planning Agent listening on ${PORT}; card at ${PUBLIC_BASE_URL}/.well-known/agent-card.json`
  );
});
