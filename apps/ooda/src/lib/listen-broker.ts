import { ListenBroker } from "@gmacko/ooda/db/listen-broker";
import { env } from "~/env";

export const listenBroker = new ListenBroker(env.DATABASE_URL);
