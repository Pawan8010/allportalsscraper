import https from "node:https";

// A small number of public government portals serve an incomplete TLS
// certificate chain that browsers repair automatically but Node rejects.
// Keep the exception scoped to those adapter clients; never weaken TLS for
// the API server, database, authentication, email, or any other portal.
export const incompleteChainAgent = new https.Agent({ rejectUnauthorized: false });
