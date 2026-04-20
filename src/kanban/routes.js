// backend/src/kanban/routes.js
import { getKanbanData } from "./controllers.js";

export default async function kanbanRoutes(server) {
  const guard = server.authenticate ? { preHandler: [server.authenticate] } : {};

  // GET /api/kanban
  server.get("/kanban", { ...guard }, getKanbanData);
}
