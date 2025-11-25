// src/empleados/routes.js
import {
  listEmpleados,
  getEmpleado,
  createEmpleado,
  updateEmpleado,
  deleteEmpleado,
  disableEmpleado,
  restoreEmpleado,
} from "./controllers.js";

import {
  EmpleadoQuery,
  EmpleadoCreateBody,
  EmpleadoUpdateBody,
  EmpleadoIdParam,
  EmpleadoDeleteQuery,
} from "./validators.js";

export default async function empleadosRoutes(server) {
  const guard = server.authenticate
    ? { preHandler: [server.authenticate] }
    : {};

  // Listar empleados
  server.get(
    "/empleados",
    { ...guard, schema: { querystring: EmpleadoQuery } },
    listEmpleados
  );

  // Obtener empleado
  server.get(
    "/empleados/:id",
    { ...guard, schema: { params: EmpleadoIdParam } },
    getEmpleado
  );

  // Crear
  server.post(
    "/empleados/add",
    { ...guard, schema: { body: EmpleadoCreateBody } },
    createEmpleado
  );

  // Actualizar
  server.patch(
    "/empleados/update/:id",
    { ...guard, schema: { params: EmpleadoIdParam, body: EmpleadoUpdateBody } },
    updateEmpleado
  );

  // Soft-delete
  server.patch(
    "/empleados/disable/:id",
    { ...guard, schema: { params: EmpleadoIdParam } },
    disableEmpleado
  );

  // Restaurar
  server.patch(
    "/empleados/restore/:id",
    { ...guard, schema: { params: EmpleadoIdParam } },
    restoreEmpleado
  );

  // Borrado real (solo cuando esté deshabilitado o ?force=true)
  server.delete(
    "/empleados/delete/:id",
    {
      ...guard,
      schema: { params: EmpleadoIdParam, querystring: EmpleadoDeleteQuery },
    },
    deleteEmpleado
  );
}
