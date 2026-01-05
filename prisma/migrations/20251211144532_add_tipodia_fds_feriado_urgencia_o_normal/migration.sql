-- AlterTable
ALTER TABLE "detalleVenta" ADD COLUMN     "tipoDiaId" TEXT;

-- CreateTable
CREATE TABLE "tipoDia" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "tipoDia_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "detalleVenta" ADD CONSTRAINT "detalleVenta_tipoDiaId_fkey" FOREIGN KEY ("tipoDiaId") REFERENCES "tipoDia"("id") ON DELETE CASCADE ON UPDATE CASCADE;
