-- AlterTable
ALTER TABLE "Empleado" ADD COLUMN     "afp_id" TEXT,
ADD COLUMN     "salud_id" TEXT;

-- CreateTable
CREATE TABLE "AFPConfig" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" TEXT,
    "tasa" DOUBLE PRECISION NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AFPConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaludConfig" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tasa" DOUBLE PRECISION NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaludConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AFPConfig_codigo_key" ON "AFPConfig"("codigo");

-- CreateIndex
CREATE INDEX "AFPConfig_empresa_id_idx" ON "AFPConfig"("empresa_id");

-- CreateIndex
CREATE INDEX "SaludConfig_empresa_id_idx" ON "SaludConfig"("empresa_id");

-- CreateIndex
CREATE INDEX "Empleado_afp_id_idx" ON "Empleado"("afp_id");

-- CreateIndex
CREATE INDEX "Empleado_salud_id_idx" ON "Empleado"("salud_id");

-- AddForeignKey
ALTER TABLE "Empleado" ADD CONSTRAINT "Empleado_afp_id_fkey" FOREIGN KEY ("afp_id") REFERENCES "AFPConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Empleado" ADD CONSTRAINT "Empleado_salud_id_fkey" FOREIGN KEY ("salud_id") REFERENCES "SaludConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AFPConfig" ADD CONSTRAINT "AFPConfig_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaludConfig" ADD CONSTRAINT "SaludConfig_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
