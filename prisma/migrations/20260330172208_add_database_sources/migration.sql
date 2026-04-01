-- CreateTable
CREATE TABLE "database_sources" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "connectionString" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "database_sources_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "database_sources" ADD CONSTRAINT "database_sources_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
