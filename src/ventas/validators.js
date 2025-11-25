import { Type } from "@sinclair/typebox";

const Id = Type.String({ minLength: 10 }); // cuid()

const Item = Type.Object({
  producto_id: Type.Optional(Id),
  cantidad: Type.Number({ minimum: 0 }),
  precio_unit: Type.Number({ minimum: 0 }),
});

export const VentaQuery = Type.Object({
  q: Type.Optional(Type.String()),
  estado: Type.Optional(Type.String()), // pendiente | aprobada | anulada | facturada
  clienteId: Type.Optional(Id),
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

export const VentaCreateBody = Type.Object({
  numero: Type.String({ minLength: 1 }),
  proyecto_id: Id,
  cliente_id: Id,
  estado: Type.Optional(Type.String()),
  items: Type.Array(Item),                  // total se ignora y se recalcula en backend
  empresa_id: Type.Optional(Type.String()), // MASTER puede setear explícito
});

export const VentaUpdateBody = Type.Partial(VentaCreateBody);
export const VentaIdParam = Type.Object({ id: Id });

export const EstadoBody = Type.Object({
  estado: Type.String({ minLength: 3 }), // validación final en controller
});

/* Ítems */
export const ItemCreateBody = Item;
export const ItemUpdateBody = Type.Partial(Item);
export const ItemIdParam = Type.Object({ itemId: Id });
