-- AlterTable
ALTER TABLE "Compra" ADD COLUMN     "fecha_docto" TIMESTAMP(3),
ADD COLUMN     "fecha_recepcion" TIMESTAMP(3),
ADD COLUMN     "folio" VARCHAR(50),
ADD COLUMN     "razon_social" VARCHAR(255),
ADD COLUMN     "rut_proveedor" VARCHAR(40),
ADD COLUMN     "tipo_doc" INTEGER;
