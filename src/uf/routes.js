import { getBancoCentralUF } from "./controllers.js";

export default async function ufRoutes(server) {
  server.get("/uf", getBancoCentralUF);
}
