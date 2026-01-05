// src/tareas/detalles.validators.js
import { Type } from "@sinclair/typebox";

const Id = Type.String({ minLength: 10 });

/**
 * Parámetros para listar detalles por tarea:
 * GET /tareas/:tareaId/detalles
 */
export const TareaDetalleListByTareaParam = Type.Object({
  tareaId: Id,
});

/**
 * Parámetros para identificar un detalle:
 * PATCH /tareas-detalle/update/:id
 * DELETE /tareas-detalle/delete/:id
 */
export const TareaDetalleIdParam = Type.Object({
  id: Id,
});

/**
 * Filtros opcionales (por ahora sólo estado y responsable)
 */
export const TareaDetalleQuery = Type.Object({
  estado: Type.Optional(Type.String()),
  responsableId: Type.Optional(Id),
});

/**
 * Body para crear un detalle de tarea (subtarea)
 * 👉 usamos fecha_inicio_plan + dias_plan y calculamos fecha_fin_plan en el backend
 */
export const TareaDetalleCreateBody = Type.Object({
  tarea_id: Type.String(),
  titulo: Type.String(),
  descripcion: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  responsable_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  estado: Type.Optional(Type.String()),

  // PLAN
  fecha_inicio_plan: Type.String({ format: "date-time" }),
  dias_plan: Type.Integer({ minimum: 1 }),
  fecha_fin_plan: Type.Optional(Type.String({ format: "date-time" })),

  // REAL (opcional)
  fecha_inicio_real: Type.Optional(Type.String({ format: "date-time" })),
  dias_reales: Type.Optional(Type.Integer({ minimum: 1 })),
  fecha_fin_real: Type.Optional(Type.String({ format: "date-time" })),

  // HORAS / COSTOS
  horas_plan: Type.Optional(Type.Number()),
  horas_real: Type.Optional(Type.Number()),
});

/**
 * Body para actualizar un detalle (todos los campos opcionales)
 */
export const TareaDetalleUpdateBody = Type.Partial(TareaDetalleCreateBody);
