import { Type } from "@sinclair/typebox";

const Id = Type.String({ minLength: 10 }); // cuid()

export const ProveedorQuery = Type.Object({
  q: Type.Optional(Type.String()),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  includeDeleted: Type.Optional(Type.Union([
    Type.Boolean(),
    Type.Integer({ minimum: 0, maximum: 1 })
  ])),
  empresaId: Type.Optional(Type.String()), // para MASTER
  force: Type.Optional(Type.Union([
    Type.Boolean(),
    Type.Integer({ minimum: 0, maximum: 1 })
  ])),
});

export const ProveedorCreateBody = Type.Object({
  nombre: Type.String({ minLength: 2 }),
  rut: Type.Optional(Type.String({ maxLength: 40 })),
  correo: Type.Optional(Type.String({ format: "email" })),
  telefono: Type.Optional(Type.String()),
  notas: Type.Optional(Type.String()),
  empresa_id: Type.Optional(Type.String()), // MASTER puede setear explícito
});

export const ProveedorUpdateBody = Type.Partial(ProveedorCreateBody);

export const ProveedorIdParam = Type.Object({ id: Id });
