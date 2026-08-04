-- CreateTable
CREATE TABLE "LinkedInToken" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "encryptedAccessToken" TEXT NOT NULL,
    "memberUrn" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
