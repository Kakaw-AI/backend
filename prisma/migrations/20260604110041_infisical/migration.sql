/*
  Warnings:

  - You are about to drop the column `sqliteFilePath` on the `database_sources` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "database_sources" DROP COLUMN "sqliteFilePath",
ADD COLUMN     "sqliteObjectKey" TEXT;
