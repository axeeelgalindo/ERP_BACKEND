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

import {
  listDocumentos,
  createCarpeta,
  uploadDocumento,
  deleteDocumento
} from "./documentos.controllers.js";

import {
  getEmpleadoVacaciones,
  createEmpleadoVacacion,
  updateEmpleadoVacacion,
  deleteEmpleadoVacacion,
  listGeneralVacaciones
} from "./vacaciones.controllers.js";

export default async function empleadosRoutes(server) {
  server.addHook("preHandler", server.authenticate);

  // ✅ vacaciones (general primero para evitar colisión de ruta)
  server.get("/empleados/vacaciones/general", listGeneralVacaciones);
  server.get("/empleados/:id/vacaciones", getEmpleadoVacaciones);
  server.post("/empleados/:id/vacaciones", createEmpleadoVacacion);
  server.put("/empleados/vacaciones/:vacacionId", updateEmpleadoVacacion);
  server.delete("/empleados/vacaciones/:vacacionId", deleteEmpleadoVacacion);

  server.get("/empleados", listEmpleados);
  server.get("/empleados/:id", getEmpleado);
  server.post("/empleados/add", createEmpleado);
  server.patch("/empleados/update/:id", updateEmpleado);

  server.patch("/empleados/disable/:id", disableEmpleado);
  server.patch("/empleados/restore/:id", restoreEmpleado);
  server.delete("/empleados/delete/:id", deleteEmpleado);

  // ✅ nuevo: editar rol/clave del usuario asociado al empleado
  server.patch("/empleados/:id/usuario", updateEmpleadoUsuario);

  // ✅ gestor documental
  server.get("/empleados/:id/documentos", listDocumentos);
  server.post("/empleados/:id/documentos/carpeta", createCarpeta);
  server.post("/empleados/:id/documentos/upload", uploadDocumento);
  server.delete("/empleados/documentos/:docId", deleteDocumento);
}
