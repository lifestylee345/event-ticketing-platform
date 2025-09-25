;; Event Ticketing Platform Contract
;; A comprehensive NFT-based ticketing system with anti-fraud and anti-scalping mechanisms

;; Constants
(define-constant ERR_UNAUTHORIZED (err u100))
(define-constant ERR_EVENT_NOT_FOUND (err u101))
(define-constant ERR_VENUE_NOT_FOUND (err u102))
(define-constant ERR_TICKET_NOT_FOUND (err u103))
(define-constant ERR_TICKET_NOT_OWNED (err u104))
(define-constant ERR_EVENT_CANCELLED (err u105))
(define-constant ERR_EVENT_SOLD_OUT (err u106))
(define-constant ERR_INVALID_PRICE (err u107))
(define-constant ERR_TRANSFER_RESTRICTED (err u108))
(define-constant ERR_ALREADY_CHECKED_IN (err u109))
(define-constant ERR_EVENT_NOT_STARTED (err u110))
(define-constant ERR_PRICE_TOO_HIGH (err u111))
(define-constant ERR_INSUFFICIENT_FUNDS (err u112))
(define-constant ERR_TICKET_EXPIRED (err u113))

(define-constant CONTRACT_OWNER tx-sender)
(define-constant PLATFORM_FEE_PERCENT u250) ;; 2.5% platform fee (250 basis points)
(define-constant TRANSFER_FEE_PERCENT u100) ;; 1% transfer fee (100 basis points)
(define-constant MIN_TICKET_PRICE u1000) ;; 10 STX minimum price
(define-constant BASIS_POINTS u10000) ;; 100% = 10000 basis points

;; NFT trait would be implemented in production
;; (impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

;; Data structures
(define-map venues
    uint ;; venue-id
    {
        name: (string-ascii 100),
        location: (string-ascii 200),
        capacity: uint,
        sections: (list 10 (string-ascii 50)), ;; VIP, General, etc.
        owner: principal,
        verified: bool,
        registration-date: uint
    }
)

(define-map events
    uint ;; event-id
    {
        title: (string-ascii 200),
        description: (string-ascii 500),
        organizer: principal,
        venue-id: uint,
        event-date: uint, ;; Block height
        capacity: uint,
        tickets-sold: uint,
        base-price: uint,
        max-resale-price: uint, ;; Anti-scalping price cap
        status: (string-ascii 20), ;; "active", "cancelled", "completed"
        metadata-uri: (string-ascii 500), ;; IPFS hash for event details
        category: (string-ascii 50), ;; "concert", "sports", "conference", etc.
        creation-date: uint,
        requires-kyc: bool
    }
)

(define-map tickets
    uint ;; ticket-id (NFT token-id)
    {
        event-id: uint,
        owner: principal,
        original-price: uint,
        tier: (string-ascii 50), ;; "VIP", "General", "Early Bird"
        seat-section: (optional (string-ascii 20)),
        seat-number: (optional uint),
        purchase-date: uint,
        checked-in: bool,
        check-in-date: (optional uint),
        transferable: bool,
        qr-code-hash: (string-ascii 64), ;; Hash for QR code verification
        metadata-uri: (string-ascii 500)
    }
)

(define-map ticket-transfers
    {ticket-id: uint, transfer-id: uint}
    {
        from: principal,
        to: principal,
        price: uint,
        transfer-date: uint,
        platform-fee: uint,
        transfer-fee: uint
    }
)

(define-map market-listings
    uint ;; ticket-id
    {
        seller: principal,
        price: uint,
        listed-date: uint,
        expires-at: uint,
        active: bool
    }
)

(define-map attendance-records
    {event-id: uint, attendee: principal}
    {
        ticket-id: uint,
        check-in-time: uint,
        check-in-location: (string-ascii 100),
        verified-by: principal
    }
)

(define-map revenue-shares
    {event-id: uint, recipient: principal}
    {
        share-percentage: uint, ;; basis points
        role: (string-ascii 50), ;; "artist", "venue", "promoter"
        total-earned: uint
    }
)

(define-map event-analytics
    uint ;; event-id
    {
        total-revenue: uint,
        platform-earnings: uint,
        transfer-volume: uint,
        average-resale-price: uint,
        attendance-rate: uint, ;; percentage of tickets checked in
        no-show-count: uint
    }
)

;; Data variables
(define-data-var next-venue-id uint u1)
(define-data-var next-event-id uint u1)
(define-data-var next-ticket-id uint u1)
(define-data-var next-transfer-id uint u1)
(define-data-var total-platform-earnings uint u0)
(define-data-var total-venues uint u0)
(define-data-var total-events uint u0)
(define-data-var total-tickets-minted uint u0)
(define-data-var paused bool false)

;; NFT implementation
(define-non-fungible-token event-ticket uint)

;; Private functions
(define-private (is-contract-owner)
    (is-eq tx-sender CONTRACT_OWNER)
)

(define-private (is-event-organizer (event-id uint))
    (match (map-get? events event-id)
        event-data (is-eq tx-sender (get organizer event-data))
        false
    )
)

(define-private (calculate-platform-fee (amount uint))
    (/ (* amount PLATFORM_FEE_PERCENT) BASIS_POINTS)
)

(define-private (calculate-transfer-fee (amount uint))
    (/ (* amount TRANSFER_FEE_PERCENT) BASIS_POINTS)
)

(define-private (generate-qr-hash (ticket-id uint) (event-id uint) (owner principal))
    ;; Simplified QR code hash generation
    ;; In production, would use more secure hash combining ticket data
    (unwrap-panic (as-max-len? (concat "ticket-" (int-to-ascii ticket-id)) u64))
)

(define-private (validate-resale-price (event-id uint) (price uint))
    (match (map-get? events event-id)
        event-data
            (let ((max-price (get max-resale-price event-data)))
                (and (> price u0) (<= price max-price))
            )
        false
    )
)

(define-private (update-event-analytics (event-id uint) (revenue uint) (action (string-ascii 10)))
    (let ((current-analytics (default-to 
                                {
                                    total-revenue: u0,
                                    platform-earnings: u0,
                                    transfer-volume: u0,
                                    average-resale-price: u0,
                                    attendance-rate: u0,
                                    no-show-count: u0
                                }
                                (map-get? event-analytics event-id))))
        (if (is-eq action "sale")
            (map-set event-analytics event-id
                (merge current-analytics {
                    total-revenue: (+ (get total-revenue current-analytics) revenue),
                    platform-earnings: (+ (get platform-earnings current-analytics) (calculate-platform-fee revenue))
                })
            )
            (if (is-eq action "transfer")
                (map-set event-analytics event-id
                    (merge current-analytics {
                        transfer-volume: (+ (get transfer-volume current-analytics) revenue)
                    })
                )
                false
            )
        )
    )
)

;; Public functions

;; Venue management
(define-public (register-venue
    (name (string-ascii 100))
    (location (string-ascii 200))
    (capacity uint)
    (sections (list 10 (string-ascii 50)))
)
    (let ((venue-id (var-get next-venue-id)))
        (asserts! (not (var-get paused)) ERR_UNAUTHORIZED)
        (asserts! (> capacity u0) ERR_INVALID_PRICE)
        
        (map-set venues venue-id {
            name: name,
            location: location,
            capacity: capacity,
            sections: sections,
            owner: tx-sender,
            verified: false,
            registration-date: block-height
        })
        
        (var-set next-venue-id (+ venue-id u1))
        (var-set total-venues (+ (var-get total-venues) u1))
        (ok venue-id)
    )
)

;; Verify venue (admin only)
(define-public (verify-venue (venue-id uint))
    (let ((venue-data (unwrap! (map-get? venues venue-id) ERR_VENUE_NOT_FOUND)))
        (asserts! (is-contract-owner) ERR_UNAUTHORIZED)
        
        (map-set venues venue-id (merge venue-data {verified: true}))
        (ok true)
    )
)

;; Event creation
(define-public (create-event
    (title (string-ascii 200))
    (description (string-ascii 500))
    (venue-id uint)
    (event-date uint)
    (capacity uint)
    (base-price uint)
    (max-resale-price uint)
    (metadata-uri (string-ascii 500))
    (category (string-ascii 50))
    (requires-kyc bool)
)
    (let ((event-id (var-get next-event-id))
          (venue-data (unwrap! (map-get? venues venue-id) ERR_VENUE_NOT_FOUND)))
        (asserts! (not (var-get paused)) ERR_UNAUTHORIZED)
        (asserts! (>= base-price MIN_TICKET_PRICE) ERR_INVALID_PRICE)
        (asserts! (>= max-resale-price base-price) ERR_INVALID_PRICE)
        (asserts! (<= capacity (get capacity venue-data)) ERR_INVALID_PRICE)
        (asserts! (> event-date block-height) ERR_INVALID_PRICE)
        
        (map-set events event-id {
            title: title,
            description: description,
            organizer: tx-sender,
            venue-id: venue-id,
            event-date: event-date,
            capacity: capacity,
            tickets-sold: u0,
            base-price: base-price,
            max-resale-price: max-resale-price,
            status: "active",
            metadata-uri: metadata-uri,
            category: category,
            creation-date: block-height,
            requires-kyc: requires-kyc
        })
        
        (var-set next-event-id (+ event-id u1))
        (var-set total-events (+ (var-get total-events) u1))
        (ok event-id)
    )
)

;; Mint tickets (batch minting)
(define-public (mint-tickets
    (event-id uint)
    (quantity uint)
    (tier (string-ascii 50))
    (recipients (list 100 principal))
)
    (let ((event-data (unwrap! (map-get? events event-id) ERR_EVENT_NOT_FOUND)))
        (asserts! (is-event-organizer event-id) ERR_UNAUTHORIZED)
        (asserts! (is-eq (get status event-data) "active") ERR_EVENT_CANCELLED)
        (asserts! (<= (+ (get tickets-sold event-data) quantity) (get capacity event-data)) ERR_EVENT_SOLD_OUT)
        (asserts! (is-eq (len recipients) quantity) ERR_INVALID_PRICE)
        
        ;; Mint tickets to recipients
        (fold mint-single-ticket recipients (ok u0))
    )
)

(define-private (mint-single-ticket (recipient principal) (previous-result (response uint uint)))
    (match previous-result
        success-val
            (let ((ticket-id (var-get next-ticket-id))
                  (current-event-id u1)) ;; This should be passed properly in production
                (match (nft-mint? event-ticket ticket-id recipient)
                    mint-success
                        (begin
                            (map-set tickets ticket-id {
                                event-id: current-event-id,
                                owner: recipient,
                                original-price: u0, ;; Set based on tier
                                tier: "General",
                                seat-section: none,
                                seat-number: none,
                                purchase-date: block-height,
                                checked-in: false,
                                check-in-date: none,
                                transferable: true,
                                qr-code-hash: (generate-qr-hash ticket-id current-event-id recipient),
                                metadata-uri: ""
                            })
                            (var-set next-ticket-id (+ ticket-id u1))
                            (var-set total-tickets-minted (+ (var-get total-tickets-minted) u1))
                            (ok ticket-id)
                        )
                    mint-error (err mint-error)
                )
            )
        error-val (err error-val)
    )
)

;; Purchase ticket
(define-public (purchase-ticket
    (event-id uint)
    (tier (string-ascii 50))
    (seat-section (optional (string-ascii 20)))
    (seat-number (optional uint))
)
    (let ((event-data (unwrap! (map-get? events event-id) ERR_EVENT_NOT_FOUND))
          (ticket-id (var-get next-ticket-id))
          (ticket-price (get base-price event-data))
          (platform-fee (calculate-platform-fee ticket-price))
          (total-cost (+ ticket-price platform-fee)))
        (asserts! (is-eq (get status event-data) "active") ERR_EVENT_CANCELLED)
        (asserts! (< (get tickets-sold event-data) (get capacity event-data)) ERR_EVENT_SOLD_OUT)
        
        ;; Process payment
        (try! (stx-transfer? total-cost tx-sender (as-contract tx-sender)))
        
        ;; Mint NFT ticket
        (try! (nft-mint? event-ticket ticket-id tx-sender))
        
        ;; Create ticket record
        (map-set tickets ticket-id {
            event-id: event-id,
            owner: tx-sender,
            original-price: ticket-price,
            tier: tier,
            seat-section: seat-section,
            seat-number: seat-number,
            purchase-date: block-height,
            checked-in: false,
            check-in-date: none,
            transferable: true,
            qr-code-hash: (generate-qr-hash ticket-id event-id tx-sender),
            metadata-uri: (get metadata-uri event-data)
        })
        
        ;; Update event ticket count
        (map-set events event-id
            (merge event-data {
                tickets-sold: (+ (get tickets-sold event-data) u1)
            })
        )
        
        ;; Update analytics
        (update-event-analytics event-id ticket-price "sale")
        
        (var-set next-ticket-id (+ ticket-id u1))
        (var-set total-tickets-minted (+ (var-get total-tickets-minted) u1))
        (var-set total-platform-earnings (+ (var-get total-platform-earnings) platform-fee))
        
        (ok ticket-id)
    )
)

;; Transfer ticket with anti-scalping controls
(define-public (transfer-ticket
    (ticket-id uint)
    (new-owner principal)
    (price uint)
)
    (let ((ticket-data (unwrap! (map-get? tickets ticket-id) ERR_TICKET_NOT_FOUND))
          (event-data (unwrap! (map-get? events (get event-id ticket-data)) ERR_EVENT_NOT_FOUND))
          (transfer-id (var-get next-transfer-id)))
        (asserts! (is-eq tx-sender (get owner ticket-data)) ERR_TICKET_NOT_OWNED)
        (asserts! (get transferable ticket-data) ERR_TRANSFER_RESTRICTED)
        (asserts! (validate-resale-price (get event-id ticket-data) price) ERR_PRICE_TOO_HIGH)
        
        (let ((transfer-fee (calculate-transfer-fee price))
              (total-cost (+ price transfer-fee)))
            ;; Process payment from buyer
            (try! (stx-transfer? total-cost new-owner tx-sender))
            
            ;; Transfer NFT
            (try! (nft-transfer? event-ticket ticket-id tx-sender new-owner))
            
            ;; Update ticket ownership
            (map-set tickets ticket-id
                (merge ticket-data {
                    owner: new-owner,
                    qr-code-hash: (generate-qr-hash ticket-id (get event-id ticket-data) new-owner)
                })
            )
            
            ;; Record transfer
            (map-set ticket-transfers {ticket-id: ticket-id, transfer-id: transfer-id} {
                from: tx-sender,
                to: new-owner,
                price: price,
                transfer-date: block-height,
                platform-fee: u0,
                transfer-fee: transfer-fee
            })
            
            ;; Update analytics
            (update-event-analytics (get event-id ticket-data) price "transfer")
            
            (var-set next-transfer-id (+ transfer-id u1))
            (var-set total-platform-earnings (+ (var-get total-platform-earnings) transfer-fee))
            
            (ok true)
        )
    )
)

;; Check-in for event attendance
(define-public (check-in-ticket
    (ticket-id uint)
    (event-id uint)
    (location (string-ascii 100))
)
    (let ((ticket-data (unwrap! (map-get? tickets ticket-id) ERR_TICKET_NOT_FOUND))
          (event-data (unwrap! (map-get? events event-id) ERR_EVENT_NOT_FOUND)))
        (asserts! (is-eq (get event-id ticket-data) event-id) ERR_TICKET_NOT_FOUND)
        (asserts! (not (get checked-in ticket-data)) ERR_ALREADY_CHECKED_IN)
        (asserts! (>= block-height (get event-date event-data)) ERR_EVENT_NOT_STARTED)
        (asserts! (< block-height (+ (get event-date event-data) u144)) ERR_TICKET_EXPIRED) ;; 24 hours after event
        
        ;; Update ticket check-in status
        (map-set tickets ticket-id
            (merge ticket-data {
                checked-in: true,
                check-in-date: (some block-height)
            })
        )
        
        ;; Record attendance
        (map-set attendance-records {event-id: event-id, attendee: (get owner ticket-data)} {
            ticket-id: ticket-id,
            check-in-time: block-height,
            check-in-location: location,
            verified-by: tx-sender
        })
        
        (ok true)
    )
)

;; Cancel event (organizer only)
(define-public (cancel-event (event-id uint))
    (let ((event-data (unwrap! (map-get? events event-id) ERR_EVENT_NOT_FOUND)))
        (asserts! (is-event-organizer event-id) ERR_UNAUTHORIZED)
        (asserts! (is-eq (get status event-data) "active") ERR_EVENT_CANCELLED)
        
        (map-set events event-id (merge event-data {status: "cancelled"}))
        (ok true)
    )
)

;; Set resale price cap
(define-public (set-resale-price-cap
    (event-id uint)
    (max-price uint)
)
    (let ((event-data (unwrap! (map-get? events event-id) ERR_EVENT_NOT_FOUND)))
        (asserts! (is-event-organizer event-id) ERR_UNAUTHORIZED)
        (asserts! (>= max-price (get base-price event-data)) ERR_INVALID_PRICE)
        
        (map-set events event-id (merge event-data {max-resale-price: max-price}))
        (ok true)
    )
)

;; Emergency pause (admin only)
(define-public (toggle-pause)
    (begin
        (asserts! (is-contract-owner) ERR_UNAUTHORIZED)
        (var-set paused (not (var-get paused)))
        (ok (var-get paused))
    )
)

;; NFT trait functions
(define-read-only (get-last-token-id)
    (ok (- (var-get next-ticket-id) u1))
)

(define-read-only (get-token-uri (token-id uint))
    (match (map-get? tickets token-id)
        ticket-data (ok (some (get metadata-uri ticket-data)))
        (ok none)
    )
)

(define-read-only (get-owner (token-id uint))
    (ok (nft-get-owner? event-ticket token-id))
)

;; Read-only functions
(define-read-only (get-venue (venue-id uint))
    (map-get? venues venue-id)
)

(define-read-only (get-event (event-id uint))
    (map-get? events event-id)
)

(define-read-only (get-ticket (ticket-id uint))
    (map-get? tickets ticket-id)
)

(define-read-only (get-ticket-transfer (ticket-id uint) (transfer-id uint))
    (map-get? ticket-transfers {ticket-id: ticket-id, transfer-id: transfer-id})
)

(define-read-only (get-attendance-record (event-id uint) (attendee principal))
    (map-get? attendance-records {event-id: event-id, attendee: attendee})
)

(define-read-only (get-event-analytics (event-id uint))
    (map-get? event-analytics event-id)
)

(define-read-only (get-platform-stats)
    {
        total-venues: (var-get total-venues),
        total-events: (var-get total-events),
        total-tickets: (var-get total-tickets-minted),
        platform-earnings: (var-get total-platform-earnings),
        contract-paused: (var-get paused)
    }
)

(define-read-only (validate-qr-code (ticket-id uint) (provided-hash (string-ascii 64)))
    (match (map-get? tickets ticket-id)
        ticket-data
            (is-eq (get qr-code-hash ticket-data) provided-hash)
        false
    )
)


;; title: event-ticketing
;; version:
;; summary:
;; description:

;; traits
;;

;; token definitions
;;

;; constants
;;

;; data vars
;;

;; data maps
;;

;; public functions
;;

;; read only functions
;;

;; private functions
;;

