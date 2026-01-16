import { createTipoDia,createTipoItem,createUnidadItem } from "./controllers.js";

export default async function complementsRoutes(server) {
  server.post("/complements/tipoDia/add", createTipoDia);
  server.post("/complements/unidadItem/add", createUnidadItem);
  server.post("/complements/tipoItem/add", createTipoItem);
}