CREATE INDEX "graph_exploration_thread_id_idx" ON "graph_exploration" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "findings_inbox_interest_source_idx" ON "personal_vault"."findings_inbox" USING btree ("standing_interest_id","source_id");--> statement-breakpoint
CREATE INDEX "graph_edge_discovered_in_idx" ON "personal_vault"."graph_edge" USING btree ("discovered_in");--> statement-breakpoint
CREATE INDEX "graph_node_first_seen_idx" ON "personal_vault"."graph_node" USING btree ("first_seen_exploration");--> statement-breakpoint
CREATE INDEX "standing_interest_thread_id_idx" ON "personal_vault"."standing_interest" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "findings_inbox_interest_source_idx" ON "research_vault"."findings_inbox" USING btree ("standing_interest_id","source_id");--> statement-breakpoint
CREATE INDEX "graph_edge_discovered_in_idx" ON "research_vault"."graph_edge" USING btree ("discovered_in");--> statement-breakpoint
CREATE INDEX "graph_node_first_seen_idx" ON "research_vault"."graph_node" USING btree ("first_seen_exploration");--> statement-breakpoint
CREATE INDEX "standing_interest_thread_id_idx" ON "research_vault"."standing_interest" USING btree ("thread_id");