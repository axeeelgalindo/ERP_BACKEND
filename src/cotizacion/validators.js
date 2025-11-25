// src/modules/cotizaciones/validators.js
import { Type } from "@sinclair/typebox";

const Id = Type.String({ minLength: 10 }); // cuid()

const Item = Type.Object({
  producto_id: Type.Optional(Id),
  cantidad: Type.Number({ minimum: 0 }),
  precio_unit: Type.Number({ minimum: 0 }),
});

/**
 * Querystring para listar / borrar (force, includeDeleted, etc.)
 */
export const CotizacionQuery = Type.Object({
  q: Type.Optional(Type.String()),
  estado: Type.Optional(Type.String()), // borrador | enviada | aceptada | rechazada | anulada
  clienteId: Type.Optional(Id),
  proyectoId: Type.Optional(Id),

  // filtros por fecha (YYYY-MM-DD)
  desde: Type.Optional(Type.String()),
  hasta: Type.Optional(Type.String()),

  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),

  // para MASTER
  empresaId: Type.Optional(Type.String()),

  includeDeleted: Type.Optional(
    Type.Union([
      Type.Boolean(),
      Type.Integer({ minimum: 0, maximum: 1 }),
    ])
  ),

  // para DELETE ?force=true
  force: Type.Optional(
    Type.Union([
      Type.Boolean(),
      Type.Integer({ minimum: 0, maximum: 1 }),
    ])
  ),
});

/**
 * CREATE:
 *  - YA NO lleva "numero" (lo genera la BD con autoincrement)
 */
export const CotizacionCreateBody = Type.Object({
  proyecto_id: Id,
  cliente_id: Id,
  estado: Type.Optional(Type.String()), // se normaliza en controller
  items: Type.Array(Item),              // total se ignora y se recalcula
  empresa_id: Type.Optional(Type.String()), // MASTER puede setear explícito
});

/**
 * UPDATE:
 *  - Tampoco permitimos "numero" (no se puede modificar)
 *  - Hacemos todos los campos opcionales
 */
export const CotizacionUpdateBody = Type.Partial(
  Type.Object({
    proyecto_id: Id,
    cliente_id: Id,
    estado: Type.String(),
    items: Type.Array(Item),
  })
);

export const CotizacionIdParam = Type.Object({ id: Id });

export const EstadoBody = Type.Object({
  estado: Type.String({ minLength: 3 }), // validado luego en controller con enum ESTADOS
});

/* ===== Ítems ===== */
export const ItemCreateBody = Item;

export const ItemUpdateBody = Type.Partial(Item);

export const ItemIdParam = Type.Object({
  itemId: Id,
});
