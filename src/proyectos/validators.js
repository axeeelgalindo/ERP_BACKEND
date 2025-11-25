import { Type } from "@sinclair/typebox";

const Id = Type.String({ minLength: 10 }); // cuid()

export const ProyectoQuery = Type.Object({
  q: Type.Optional(Type.String()),
  estado: Type.Optional(Type.String()), // activo | pausado | cerrado | aprobado
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  empresaId: Type.Optional(Type.String()), // para MASTER
  includeDeleted: Type.Optional(Type.Union([
    Type.Boolean(),
    Type.Integer({ minimum: 0, maximum: 1 })
  ])),
});

export const ProyectoCreateBody = Type.Object({
  nombre: Type.String({ minLength: 2 }),
  descripcion: Type.Optional(Type.String()),
  presupuesto: Type.Optional(Type.Number()),
  estado: Type.Optional(Type.String()),
  empresa_id: Type.Optional(Type.String()), // MASTER puede setearlo explícito
});

export const ProyectoUpdateBody = Type.Partial(ProyectoCreateBody);

export const ProyectoIdParam = Type.Object({ id: Id });