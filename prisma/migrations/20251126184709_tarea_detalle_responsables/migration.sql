-- AlterTable
ALTER TABLE "Tarea" ADD COLUMN     "total_costo_plan" DOUBLE PRECISION,
ADD COLUMN     "total_costo_real" DOUBLE PRECISION,
ADD COLUMN     "total_dias_plan" INTEGER,
ADD COLUMN     "total_dias_reales" INTEGER,
ADD COLUMN     "total_horas_plan" DOUBLE PRECISION,
ADD COLUMN     "total_horas_reales" DOUBLE PRECISION,
ADD COLUMN     "total_responsables" INTEGER;

-- CreateTable
CREATE TABLE "TareaDetalle" (
    "id" TEXT NOT NULL,
    "tarea_id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "responsable_id" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "avance" INTEGER NOT NULL DEFAULT 0,
    "fecha_inicio_plan" TIMESTAMP(3) NOT NULL,
    "fecha_fin_plan" TIMESTAMP(3) NOT NULL,
    "dias_plan" INTEGER NOT NULL,
    "fecha_inicio_real" TIMESTAMP(3),
    "fecha_fin_real" TIMESTAMP(3),
    "dias_reales" INTEGER,
    "horas_plan" DOUBLE PRECISION,
    "horas_real" DOUBLE PRECISION,
    "valor_hora" DOUBLE PRECISION,
    "costo_plan" DOUBLE PRECISION,
    "costo_real" DOUBLE PRECISION,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "TareaDetalle_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TareaDetalle" ADD CONSTRAINT "TareaDetalle_tarea_id_fkey" FOREIGN KEY ("tarea_id") REFERENCES "Tarea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TareaDetalle" ADD CONSTRAINT "TareaDetalle_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "Empleado"("id") ON DELETE SET NULL ON UPDATE CASCADE;
