-- Lets reset-access and deactivation sign out every existing session.
ALTER TABLE "AdminUser" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
