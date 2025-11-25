import { Type } from "@sinclair/typebox";

const Id = Type.String({ minLength: 10 }); // cuid()

export const ProductoQuery = Type.Object({
  q: Type.Optional(Type.String()),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  includeDeleted: Type.Optional(Type.Union([
    Type.Boolean(),
    Type.Integer({ minimum: 0, maximum: 1 })
  ])),
  empresaId: Type.Optional(Type.String()), // para MASTER en list
  force: Type.Optional(Type.Union([
    Type.Boolean(),
    Type.Integer({ minimum: 0, maximum: 1 })
  ])), // lo usamos también en delete
});

export const ProductoCreateBody = Type.Object({
  nombre: Type.String({ minLength: 2 }),
  sku: Type.Optional(Type.String()),
  precio: Type.Number(),
  stock: Type.Optional(Type.Integer()),
  empresa_id: Type.Optional(Type.String()), // MASTER puede setear explícito
});

export const ProductoUpdateBody = Type.Partial(ProductoCreateBody);

export const ProductoIdParam = Type.Object({ id: Id });