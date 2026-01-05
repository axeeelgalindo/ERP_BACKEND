// src/tareas/validators.js
import { Type } from "@sinclair/typebox";

const Id = Type.String({ minLength: 10 });

export const TareaQuery = Type.Object({
  proyectoId: Type.Optional(Id),
  responsableId: Type.Optional(Id),
  estado: Type.Optional(Type.String()),
  desde: Type.Optional(Type.String({ format: "date-time" })),
  hasta: Type.Optional(Type.String({ format: "date-time" })),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  sort: Type.Optional(Type.String()),
  includeDeleted: Type.Optional(
    Type.Union([Type.Boolean(), Type.Integer({ minimum: 0, maximum: 1 })])
  ),
});

export const TareaCreateBody = Type.Object({
  proyecto_id: Type.String(),
  nombre: Type.String(),
  descripcion: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  responsable_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  prioridad: Type.Optional(Type.Integer()),

  // 👉 INPUT REAL del frontend: fecha_inicio_plan + dias_plan
  fecha_inicio_plan: Type.String({ format: "date-time" }),
  dias_plan: Type.Integer({ minimum: 1 }),
  // se calcula en backend, por eso OPCIONAL
  fecha_fin_plan: Type.Optional(Type.String({ format: "date-time" })),

  // REAL (opcional)
  fecha_inicio_real: Type.Optional(Type.String({ format: "date-time" })),
  dias_reales: Type.Optional(Type.Integer({ minimum: 1 })),
  fecha_fin_real: Type.Optional(Type.String({ format: "date-time" })),

  // Subtareas opcionales
  detalles: Type.Optional(
    Type.Array(
      Type.Object({
        titulo: Type.String(),
        descripcion: Type.Optional(
          Type.Union([Type.String(), Type.Null()])
        ),
        responsable_id: Type.Optional(
          Type.Union([Type.String(), Type.Null()])
        ),

        // PLAN subtarea
        fecha_inicio_plan: Type.String({ format: "date-time" }),
        dias_plan: Type.Integer({ minimum: 1 }),
        fecha_fin_plan: Type.Optional(
          Type.String({ format: "date-time" })
        ),

        // REAL subtarea (opcional)
        fecha_inicio_real: Type.Optional(
          Type.String({ format: "date-time" })
        ),
        dias_reales: Type.Optional(Type.Integer({ minimum: 1 })),
        fecha_fin_real: Type.Optional(
          Type.String({ format: "date-time" })
        ),
      })
    )
  ),
});

// PATCH: todo opcional
export const TareaUpdateBody = Type.Partial(TareaCreateBody);

export const TareaIdParam = Type.Object({ id: Id });

export const TareaDepCreate = Type.Object({
  tarea_id: Id,
  predecesora_id: Id,
  tipo: Type.Optional(Type.String()), // FS/SS/FF/SF
});

export const TareaDepIdParam = Type.Object({ id: Id });
