/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,clientLeadId]` on the table `Lead` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `clientLeadId` to the `Lead` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "clientLeadId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Lead_tenantId_clientLeadId_key" ON "Lead"("tenantId", "clientLeadId");
