import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { registry } from "./actors/registry.js";

const app = new Hono();
app.all("/api/rivet/*", (c) => registry.handler(c.req.raw));

serve({ fetch: app.fetch, port: 6420 }, () => {
  console.log("Doctrine server running on http://localhost:6420");
});
