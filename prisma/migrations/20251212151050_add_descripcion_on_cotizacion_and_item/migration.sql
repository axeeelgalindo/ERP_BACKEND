-- AlterTable
ALTER TABLE "Cotizacion" ALTER COLUMN "cliente_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CotizacionItem" ADD COLUMN     "descripcion" TEXT;
