import { Type } from "@sinclair/typebox";

const Id = Type.String({ minLength: 10 }); // cuid()

export const ClienteQuery = Type.Object({
  q: Type.Optional(Type.String()),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  includeDeleted: Type.Optional(Type.Union([
    Type.Boolean(),
    Type.Integer({ minimum: 0, maximum: 1 })
  ])),
});

export const ClienteCreateBody = Type.Object({
  nombre: Type.String({ minLength: 2 }),
  rut: Type.Optional(Type.String({ maxLength: 40 })),
  correo: Type.Optional(Type.String()),
  telefono: Type.Optional(Type.String()),
  notas: Type.Optional(Type.String()),
});

export const ClienteUpdateBody = Type.Partial(ClienteCreateBody);
export const ClienteIdParam = Type.Object({ id: Id });