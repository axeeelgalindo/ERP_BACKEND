-- AlterTable
ALTER TABLE "Cotizacion" ADD COLUMN     "acuerdo_pago" TEXT,
ADD COLUMN     "cantidad" INTEGER,
ADD COLUMN     "iva" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "terminos_condiciones" TEXT;
