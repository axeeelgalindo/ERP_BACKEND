// src/empleados/validators.js
import { Type } from "@sinclair/typebox";

// cuid() string
const Id = Type.String({ minLength: 10 });

export const EmpleadoQuery = Type.Object({
  q: Type.Optional(Type.String()),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })), // 👈 antes 100
  includeDeleted: Type.Optional(
    Type.Union([
      Type.Boolean(),
      Type.Integer({ minimum: 0, maximum: 1 }),
    ])
  ),
});

export const EmpleadoCreateBody = Type.Object({
  usuario_id: Type.Optional(Id),           // opcional: link a usuario
  cargo: Type.Optional(Type.String()),
  telefono: Type.Optional(Type.String()),
  fecha_ingreso: Type.Optional(Type.String()), // ISO date
  sueldo_base: Type.Optional(Type.Integer()),
  activo: Type.Optional(Type.Boolean()),
});

export const EmpleadoUpdateBody = Type.Partial(EmpleadoCreateBody);

export const EmpleadoDeleteQuery = Type.Object({
  force: Type.Optional(Type.Boolean()),
});

export const EmpleadoIdParam = Type.Object({ id: Id });
