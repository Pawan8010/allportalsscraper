import "dotenv/config";
import { runAlertCycle } from "../src/services/alertService";
import { prisma } from "../src/services/prisma";
import { logger } from "../src/utils/logger";

async function main() {
    logger.info("Manually triggering an alert cycle...");
    const result = await runAlertCycle();
    logger.info(`Alert cycle finished! Users notified: ${result.usersNotified}, Tenders sent: ${result.tendersSent}`);

    // If no users were notified, it means nobody is subscribed or no new tenders matched their keywords.
    if (result.usersNotified === 0) {
        logger.info("Note: 0 users notified means either no active subscriptions exist or no matching tenders were found.");
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
