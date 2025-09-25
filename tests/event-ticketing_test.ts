import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v1.0.0/index.ts';
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

Clarinet.test({
    name: "Test venue registration",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const venue_owner = accounts.get("wallet_1")!;
        
        let block = chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "register-venue",
                [
                    types.ascii("Madison Square Garden"),
                    types.ascii("New York City, NY"),
                    types.uint(20000),
                    types.list([
                        types.ascii("VIP"),
                        types.ascii("General"),
                        types.ascii("Floor")
                    ])
                ],
                venue_owner.address
            )
        ]);
        
        assertEquals(block.receipts.length, 1);
        block.receipts[0].result.expectOk().expectUint(1);
        
        // Check venue data
        let venueData = chain.callReadOnlyFn(
            "event-ticketing",
            "get-venue",
            [types.uint(1)],
            deployer.address
        );
        
        let venue = venueData.result.expectSome().expectTuple();
        assertEquals(venue['name'], types.ascii("Madison Square Garden"));
        assertEquals(venue['capacity'], types.uint(20000));
        assertEquals(venue['verified'], types.bool(false));
    }
});

Clarinet.test({
    name: "Test venue verification by admin",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const venue_owner = accounts.get("wallet_1")!;
        
        // Register venue first
        chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "register-venue",
                [
                    types.ascii("Hollywood Bowl"),
                    types.ascii("Los Angeles, CA"),
                    types.uint(15000),
                    types.list([
                        types.ascii("VIP"),
                        types.ascii("General")
                    ])
                ],
                venue_owner.address
            )
        ]);
        
        // Verify venue (admin only)
        let verifyBlock = chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "verify-venue",
                [types.uint(1)],
                deployer.address
            )
        ]);
        
        assertEquals(verifyBlock.receipts.length, 1);
        assertEquals(verifyBlock.receipts[0].result, "(ok true)");
        
        // Check verification status
        let venueData = chain.callReadOnlyFn(
            "event-ticketing",
            "get-venue",
            [types.uint(1)],
            deployer.address
        );
        
        let venue = venueData.result.expectSome().expectTuple();
        assertEquals(venue['verified'], types.bool(true));
    }
});

Clarinet.test({
    name: "Test event creation",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const organizer = accounts.get("wallet_1")!;
        const future_block = 1000;
        
        // Register venue first
        chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "register-venue",
                [
                    types.ascii("Concert Hall"),
                    types.ascii("Downtown"),
                    types.uint(5000),
                    types.list([types.ascii("General")])
                ],
                organizer.address
            )
        ]);
        
        // Create event
        let eventBlock = chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "create-event",
                [
                    types.ascii("Rock Concert 2024"),
                    types.ascii("Annual rock music festival with top artists"),
                    types.uint(1), // venue-id
                    types.uint(future_block), // event-date
                    types.uint(5000), // capacity
                    types.uint(5000), // base-price (50 STX)
                    types.uint(10000), // max-resale-price (100 STX)
                    types.ascii("ipfs://event-metadata-hash"),
                    types.ascii("concert"),
                    types.bool(false) // requires-kyc
                ],
                organizer.address
            )
        ]);
        
        assertEquals(eventBlock.receipts.length, 1);
        eventBlock.receipts[0].result.expectOk().expectUint(1);
        
        // Check event data
        let eventData = chain.callReadOnlyFn(
            "event-ticketing",
            "get-event",
            [types.uint(1)],
            organizer.address
        );
        
        let event = eventData.result.expectSome().expectTuple();
        assertEquals(event['title'], types.ascii("Rock Concert 2024"));
        assertEquals(event['capacity'], types.uint(5000));
        assertEquals(event['status'], types.ascii("active"));
        assertEquals(event['tickets-sold'], types.uint(0));
    }
});

Clarinet.test({
    name: "Test ticket purchase",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const organizer = accounts.get("wallet_1")!;
        const buyer = accounts.get("wallet_2")!;
        const future_block = 1000;
        
        // Setup venue and event
        chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "register-venue",
                [
                    types.ascii("Theater"),
                    types.ascii("Broadway"),
                    types.uint(2000),
                    types.list([types.ascii("Orchestra"), types.ascii("Balcony")])
                ],
                organizer.address
            )
        ]);
        
        chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "create-event",
                [
                    types.ascii("Broadway Show"),
                    types.ascii("Musical theater performance"),
                    types.uint(1),
                    types.uint(future_block),
                    types.uint(2000),
                    types.uint(8000), // 80 STX
                    types.uint(12000), // 120 STX max resale
                    types.ascii("ipfs://show-metadata"),
                    types.ascii("theater"),
                    types.bool(false)
                ],
                organizer.address
            )
        ]);
        
        // Purchase ticket
        let purchaseBlock = chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "purchase-ticket",
                [
                    types.uint(1), // event-id
                    types.ascii("Orchestra"),
                    types.some(types.ascii("A")),
                    types.some(types.uint(15))
                ],
                buyer.address
            )
        ]);
        
        assertEquals(purchaseBlock.receipts.length, 1);
        purchaseBlock.receipts[0].result.expectOk().expectUint(1);
        
        // Check ticket data
        let ticketData = chain.callReadOnlyFn(
            "event-ticketing",
            "get-ticket",
            [types.uint(1)],
            buyer.address
        );
        
        let ticket = ticketData.result.expectSome().expectTuple();
        assertEquals(ticket['event-id'], types.uint(1));
        assertEquals(ticket['owner'], types.principal(buyer.address));
        assertEquals(ticket['tier'], types.ascii("Orchestra"));
        assertEquals(ticket['checked-in'], types.bool(false));
        assertEquals(ticket['transferable'], types.bool(true));
    }
});

Clarinet.test({
    name: "Test anti-scalping transfer restrictions",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const organizer = accounts.get("wallet_1")!;
        const buyer = accounts.get("wallet_2")!;
        const scalper = accounts.get("wallet_3")!;
        const future_block = 1000;
        
        // Setup event with price cap
        chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "register-venue",
                [
                    types.ascii("Stadium"),
                    types.ascii("Sports Complex"),
                    types.uint(50000),
                    types.list([types.ascii("General")])
                ],
                organizer.address
            )
        ]);
        
        chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "create-event",
                [
                    types.ascii("Championship Game"),
                    types.ascii("Final championship match"),
                    types.uint(1),
                    types.uint(future_block),
                    types.uint(50000),
                    types.uint(10000), // 100 STX
                    types.uint(15000), // 150 STX max resale (50% markup allowed)
                    types.ascii("ipfs://game-metadata"),
                    types.ascii("sports"),
                    types.bool(false)
                ],
                organizer.address
            )
        ]);
        
        // Purchase ticket
        chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "purchase-ticket",
                [
                    types.uint(1),
                    types.ascii("General"),
                    types.none(),
                    types.none()
                ],
                buyer.address
            )
        ]);
        
        // Try to transfer at valid price (within cap)
        let validTransferBlock = chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "transfer-ticket",
                [
                    types.uint(1),
                    types.principal(scalper.address),
                    types.uint(14000) // 140 STX (within 150 STX cap)
                ],
                buyer.address
            )
        ]);
        
        assertEquals(validTransferBlock.receipts.length, 1);
        assertEquals(validTransferBlock.receipts[0].result, "(ok true)");
        
        // Verify ownership transferred
        let ticketData = chain.callReadOnlyFn(
            "event-ticketing",
            "get-ticket",
            [types.uint(1)],
            buyer.address
        );
        
        let ticket = ticketData.result.expectSome().expectTuple();
        assertEquals(ticket['owner'], types.principal(scalper.address));
    }
});

Clarinet.test({
    name: "Test check-in functionality",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const organizer = accounts.get("wallet_1")!;
        const attendee = accounts.get("wallet_2")!;
        const staff = accounts.get("wallet_3")!;
        
        // Setup event happening now (current block)
        chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "register-venue",
                [
                    types.ascii("Convention Center"),
                    types.ascii("Downtown"),
                    types.uint(10000),
                    types.list([types.ascii("General")])
                ],
                organizer.address
            )
        ]);
        
        chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "create-event",
                [
                    types.ascii("Tech Conference"),
                    types.ascii("Annual technology conference"),
                    types.uint(1),
                    types.uint(5), // Event starts at block 5
                    types.uint(10000),
                    types.uint(5000),
                    types.uint(7500),
                    types.ascii("ipfs://conf-metadata"),
                    types.ascii("conference"),
                    types.bool(false)
                ],
                organizer.address
            )
        ]);
        
        // Purchase ticket
        chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "purchase-ticket",
                [
                    types.uint(1),
                    types.ascii("General"),
                    types.none(),
                    types.none()
                ],
                attendee.address
            )
        ]);
        
        // Mine blocks to reach event start time
        chain.mineEmptyBlock(); // Block 4
        chain.mineEmptyBlock(); // Block 5 (event starts)
        
        // Check-in ticket
        let checkinBlock = chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "check-in-ticket",
                [
                    types.uint(1), // ticket-id
                    types.uint(1), // event-id
                    types.ascii("Main Entrance")
                ],
                staff.address
            )
        ]);
        
        assertEquals(checkinBlock.receipts.length, 1);
        assertEquals(checkinBlock.receipts[0].result, "(ok true)");
        
        // Verify check-in status
        let ticketData = chain.callReadOnlyFn(
            "event-ticketing",
            "get-ticket",
            [types.uint(1)],
            attendee.address
        );
        
        let ticket = ticketData.result.expectSome().expectTuple();
        assertEquals(ticket['checked-in'], types.bool(true));
        
        // Check attendance record
        let attendanceData = chain.callReadOnlyFn(
            "event-ticketing",
            "get-attendance-record",
            [types.uint(1), types.principal(attendee.address)],
            staff.address
        );
        
        let attendance = attendanceData.result.expectSome().expectTuple();
        assertEquals(attendance['ticket-id'], types.uint(1));
        assertEquals(attendance['check-in-location'], types.ascii("Main Entrance"));
    }
});

Clarinet.test({
    name: "Test event cancellation",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const organizer = accounts.get("wallet_1")!;
        const other_user = accounts.get("wallet_2")!;
        const future_block = 1000;
        
        // Setup event
        chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "register-venue",
                [
                    types.ascii("Club"),
                    types.ascii("Entertainment District"),
                    types.uint(500),
                    types.list([types.ascii("VIP"), types.ascii("General")])
                ],
                organizer.address
            )
        ]);
        
        chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "create-event",
                [
                    types.ascii("Live Music Night"),
                    types.ascii("Local bands showcase"),
                    types.uint(1),
                    types.uint(future_block),
                    types.uint(500),
                    types.uint(3000),
                    types.uint(4500),
                    types.ascii("ipfs://music-metadata"),
                    types.ascii("concert"),
                    types.bool(false)
                ],
                organizer.address
            )
        ]);
        
        // Unauthorized user tries to cancel (should fail)
        let unauthorizedCancelBlock = chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "cancel-event",
                [types.uint(1)],
                other_user.address
            )
        ]);
        
        assertEquals(unauthorizedCancelBlock.receipts.length, 1);
        unauthorizedCancelBlock.receipts[0].result.expectErr(types.uint(100)); // ERR_UNAUTHORIZED
        
        // Organizer cancels event (should succeed)
        let cancelBlock = chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "cancel-event",
                [types.uint(1)],
                organizer.address
            )
        ]);
        
        assertEquals(cancelBlock.receipts.length, 1);
        assertEquals(cancelBlock.receipts[0].result, "(ok true)");
        
        // Check event status
        let eventData = chain.callReadOnlyFn(
            "event-ticketing",
            "get-event",
            [types.uint(1)],
            organizer.address
        );
        
        let event = eventData.result.expectSome().expectTuple();
        assertEquals(event['status'], types.ascii("cancelled"));
    }
});

Clarinet.test({
    name: "Test platform statistics",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const organizer = accounts.get("wallet_1")!;
        
        // Initial stats should be zero/empty
        let initialStats = chain.callReadOnlyFn(
            "event-ticketing",
            "get-platform-stats",
            [],
            deployer.address
        );
        
        let initial = initialStats.result.expectTuple();
        assertEquals(initial['total-venues'], types.uint(0));
        assertEquals(initial['total-events'], types.uint(0));
        assertEquals(initial['total-tickets'], types.uint(0));
        
        // Register venue and create event
        chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "register-venue",
                [
                    types.ascii("Test Venue"),
                    types.ascii("Test Location"),
                    types.uint(1000),
                    types.list([types.ascii("General")])
                ],
                organizer.address
            )
        ]);
        
        chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "create-event",
                [
                    types.ascii("Test Event"),
                    types.ascii("Test Description"),
                    types.uint(1),
                    types.uint(1000),
                    types.uint(1000),
                    types.uint(5000),
                    types.uint(7500),
                    types.ascii("ipfs://test-metadata"),
                    types.ascii("test"),
                    types.bool(false)
                ],
                organizer.address
            )
        ]);
        
        // Purchase ticket to increment ticket count
        chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "purchase-ticket",
                [
                    types.uint(1),
                    types.ascii("General"),
                    types.none(),
                    types.none()
                ],
                organizer.address
            )
        ]);
        
        // Check updated stats
        let updatedStats = chain.callReadOnlyFn(
            "event-ticketing",
            "get-platform-stats",
            [],
            deployer.address
        );
        
        let updated = updatedStats.result.expectTuple();
        assertEquals(updated['total-venues'], types.uint(1));
        assertEquals(updated['total-events'], types.uint(1));
        assertEquals(updated['total-tickets'], types.uint(1));
        assertEquals(updated['contract-paused'], types.bool(false));
    }
});

Clarinet.test({
    name: "Test emergency pause functionality",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get("deployer")!;
        const user = accounts.get("wallet_1")!;
        
        // Non-admin tries to pause (should fail)
        let unauthorizedPauseBlock = chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "toggle-pause",
                [],
                user.address
            )
        ]);
        
        assertEquals(unauthorizedPauseBlock.receipts.length, 1);
        unauthorizedPauseBlock.receipts[0].result.expectErr(types.uint(100)); // ERR_UNAUTHORIZED
        
        // Admin pauses contract
        let pauseBlock = chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "toggle-pause",
                [],
                deployer.address
            )
        ]);
        
        assertEquals(pauseBlock.receipts.length, 1);
        assertEquals(pauseBlock.receipts[0].result, "(ok true)");
        
        // Try to register venue while paused (should fail)
        let pausedOperationBlock = chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "register-venue",
                [
                    types.ascii("Paused Venue"),
                    types.ascii("Should Fail"),
                    types.uint(1000),
                    types.list([types.ascii("General")])
                ],
                user.address
            )
        ]);
        
        assertEquals(pausedOperationBlock.receipts.length, 1);
        pausedOperationBlock.receipts[0].result.expectErr(types.uint(100)); // ERR_UNAUTHORIZED
        
        // Check platform stats show paused status
        let stats = chain.callReadOnlyFn(
            "event-ticketing",
            "get-platform-stats",
            [],
            deployer.address
        );
        
        let statsResult = stats.result.expectTuple();
        assertEquals(statsResult['contract-paused'], types.bool(true));
    }
});

Clarinet.test({
    name: "Test resale price cap setting",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const organizer = accounts.get("wallet_1")!;
        const other_user = accounts.get("wallet_2")!;
        const future_block = 1000;
        
        // Setup event
        chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "register-venue",
                [
                    types.ascii("Price Cap Venue"),
                    types.ascii("Test Location"),
                    types.uint(1000),
                    types.list([types.ascii("General")])
                ],
                organizer.address
            )
        ]);
        
        chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "create-event",
                [
                    types.ascii("Price Cap Event"),
                    types.ascii("Testing price caps"),
                    types.uint(1),
                    types.uint(future_block),
                    types.uint(1000),
                    types.uint(5000), // 50 STX base
                    types.uint(7500), // 75 STX initial max
                    types.ascii("ipfs://price-test"),
                    types.ascii("test"),
                    types.bool(false)
                ],
                organizer.address
            )
        ]);
        
        // Non-organizer tries to set price cap (should fail)
        let unauthorizedCapBlock = chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "set-resale-price-cap",
                [types.uint(1), types.uint(10000)],
                other_user.address
            )
        ]);
        
        assertEquals(unauthorizedCapBlock.receipts.length, 1);
        unauthorizedCapBlock.receipts[0].result.expectErr(types.uint(100)); // ERR_UNAUTHORIZED
        
        // Organizer sets new price cap
        let setCapBlock = chain.mineBlock([
            Tx.contractCall(
                "event-ticketing",
                "set-resale-price-cap",
                [types.uint(1), types.uint(10000)], // 100 STX max
                organizer.address
            )
        ]);
        
        assertEquals(setCapBlock.receipts.length, 1);
        assertEquals(setCapBlock.receipts[0].result, "(ok true)");
        
        // Verify price cap updated
        let eventData = chain.callReadOnlyFn(
            "event-ticketing",
            "get-event",
            [types.uint(1)],
            organizer.address
        );
        
        let event = eventData.result.expectSome().expectTuple();
        assertEquals(event['max-resale-price'], types.uint(10000));
    }
});