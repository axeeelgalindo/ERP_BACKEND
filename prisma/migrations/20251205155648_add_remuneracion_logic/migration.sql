-- AlterTable
ALTER TABLE "Empleado" ADD COLUMN     "rut" VARCHAR(40);

-- CreateTable
CREATE TABLE "HHConfig" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "horas_dia" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "dias_mes" INTEGER NOT NULL DEFAULT 30,
    "afp_porcentaje" DOUBLE PRECISION,
    "salud_porcentaje" DOUBLE PRECISION,
    "mutual_porcentaje" DOUBLE PRECISION,
    "otros_porcentaje" DOUBLE PRECISION,
    "margen_base_venta" DOUBLE PRECISION,
    "factor_normal" DOUBLE PRECISION,
    "factor_extra_50" DOUBLE PRECISION,
    "factor_extra_100" DOUBLE PRECISION,
    "factor_feriado" DOUBLE PRECISION,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HHConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemuneracionPeriodo" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "dias_mes" INTEGER NOT NULL,
    "horas_dia" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "nombre" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemuneracionPeriodo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmpleadoRemuneracion" (
    "id" TEXT NOT NULL,
    "periodo_id" TEXT NOT NULL,
    "empleado_id" TEXT NOT NULL,
    "dias_trabajados" INTEGER NOT NULL,
    "sueldo_liquido" DOUBLE PRECISION NOT NULL,
    "horas_dia" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "horas_mes" DOUBLE PRECISION NOT NULL,
    "imponible" DOUBLE PRECISION,
    "afp" DOUBLE PRECISION,
    "salud" DOUBLE PRECISION,
    "mutual" DOUBLE PRECISION,
    "otros_costos" DOUBLE PRECISION,
    "costo_empresa_mes" DOUBLE PRECISION,
    "valor_hora_costo" DOUBLE PRECISION,
    "valor_hora_venta" DOUBLE PRECISION,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmpleadoRemuneracion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmpleadoRemuneracionConcepto" (
    "id" TEXT NOT NULL,
    "remuneracion_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "factor_costo" DOUBLE PRECISION,
    "factor_venta" DOUBLE PRECISION,
    "valor_hora_costo" DOUBLE PRECISION NOT NULL,
    "valor_hora_venta" DOUBLE PRECISION NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmpleadoRemuneracionConcepto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HHConfig_empresa_id_idx" ON "HHConfig"("empresa_id");

-- CreateIndex
CREATE INDEX "RemuneracionPeriodo_empresa_id_idx" ON "RemuneracionPeriodo"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "RemuneracionPeriodo_empresa_id_anio_mes_key" ON "RemuneracionPeriodo"("empresa_id", "anio", "mes");

-- CreateIndex
CREATE INDEX "EmpleadoRemuneracion_empleado_id_idx" ON "EmpleadoRemuneracion"("empleado_id");

-- CreateIndex
CREATE UNIQUE INDEX "EmpleadoRemuneracion_periodo_id_empleado_id_key" ON "EmpleadoRemuneracion"("periodo_id", "empleado_id");

-- CreateIndex
CREATE UNIQUE INDEX "EmpleadoRemuneracionConcepto_remuneracion_id_tipo_key" ON "EmpleadoRemuneracionConcepto"("remuneracion_id", "tipo");

-- AddForeignKey
ALTER TABLE "HHConfig" ADD CONSTRAINT "HHConfig_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemuneracionPeriodo" ADD CONSTRAINT "RemuneracionPeriodo_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmpleadoRemuneracion" ADD CONSTRAINT "EmpleadoRemuneracion_periodo_id_fkey" FOREIGN KEY ("periodo_id") REFERENCES "RemuneracionPeriodo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmpleadoRemuneracion" ADD CONSTRAINT "EmpleadoRemuneracion_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "Empleado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmpleadoRemuneracionConcepto" ADD CONSTRAINT "EmpleadoRemuneracionConcepto_remuneracion_id_fkey" FOREIGN KEY ("remuneracion_id") REFERENCES "EmpleadoRemuneracion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
