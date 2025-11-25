import { Type } from "@sinclair/typebox";

const Id = Type.String({ minLength: 10 });

export const EmpresaCreateBody = Type.Object({
  nombre: Type.String({ minLength: 2 }),
  rut: Type.Optional(Type.String({ maxLength: 40 })),
  correo: Type.Optional(Type.String({ format: "email" })),
  telefono: Type.Optional(Type.String()),
  activa: Type.Optional(Type.Boolean()),
});

export const EmpresaUpdateBody = Type.Partial(EmpresaCreateBody);

export const EmpresaIdParam = Type.Object({ id: Id });

export const EmpresaQuery = Type.Object({
  q: Type.Optional(Type.String()),
  activa: Type.Optional(Type.Boolean()),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  includeDeleted: Type.Optional(
    Type.Union([
      Type.Boolean(),
      Type.Integer({ minimum: 0, maximum: 1 }),
    ])
  ),
});

export const EmpresaDeleteQuery = Type.Object({
  force: Type.Optional(Type.Boolean()),
});
