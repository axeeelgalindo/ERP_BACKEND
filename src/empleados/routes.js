import {
  listEmpleados,
  getEmpleado,
  createEmpleado,
  updateEmpleado,
  deleteEmpleado,
  disableEmpleado,
  restoreEmpleado,
  updateEmpleadoUsuario
} from "./controllers.js";

export default async function empleadosRoutes(server) {
  server.addHook("preHandler", server.authenticate);

  server.get("/empleados", listEmpleados);
  server.get("/empleados/:id", getEmpleado);
  server.post("/empleados/add", createEmpleado);
  server.patch("/empleados/update/:id", updateEmpleado);

  server.patch("/empleados/disable/:id", disableEmpleado);
  server.patch("/empleados/restore/:id", restoreEmpleado);
  server.delete("/empleados/delete/:id", deleteEmpleado);

  // ✅ nuevo: editar rol/clave del usuario asociado al empleado
  server.patch("/empleados/:id/usuario", updateEmpleadoUsuario);
}
