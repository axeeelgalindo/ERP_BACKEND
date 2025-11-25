import { Type } from "@sinclair/typebox";

const Id = Type.String({ minLength: 10 }); // cuid()

const Item = Type.Object({
  producto_id: Type.Optional(Id),
  cantidad: Type.Number({ minimum: 0 }),
  precio_unit: Type.Number({ minimum: 0 }),
});

export const CompraQuery = Type.Object({
  q: Type.Optional(Type.String()),
  estado: Type.Optional(Type.String()), // pendiente | aprobada | cancelada (lo que definas)
  proveedorId: Type.Optional(Id),
  proyectoId: Type.Optional(Id),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  empresaId: Type.Optional(Type.String()), // para MASTER
  includeDeleted: Type.Optional(Type.Union([
    Type.Boolean(),
    Type.Integer({ minimum: 0, maximum: 1 })
  ])),
  force: Type.Optional(Type.Union([
    Type.Boolean(),
    Type.Integer({ minimum: 0, maximum: 1 })
  ])),
});

export const CompraCreateBody = Type.Object({
  numero: Type.String({ minLength: 1 }),
  proyecto_id: Id,
  proveedor_id: Id,
  estado: Type.Optional(Type.String()),
  total: Type.Optional(Type.Number({ minimum: 0 })), // si no viene, se recalcula
  items: Type.Array(Item),
  empresa_id: Type.Optional(Type.String()), // MASTER puede setear explícito
});

export const CompraUpdateBody = Type.Partial(CompraCreateBody);

export const CompraIdParam = Type.Object({ id: Id });
