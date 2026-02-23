-- AlterTable
ALTER TABLE "Cotizacion" ADD COLUMN     "descuento_monto" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "descuento_pct" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CotizacionGlosa" ADD COLUMN     "descuento_pct" DOUBLE PRECISION NOT NULL DEFAULT 0;
