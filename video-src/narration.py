"""Hinglish narration, one list item per scene of script.py.

Hindi in Devanagari, English product terms in Latin — the way it is actually
spoken on an Indian shop floor. One audio clip is generated per chapter.
"""

NARRATION = {
    "01-start-here": [
        "नमस्ते! ForgeERP में आपका स्वागत है। ये कोर्स आपको बिल्कुल शुरू से पूरा ERP चलाना सिखाएगा — sales, purchase, jobwork, manufacturing, accounting और reports तक। चलिए पहले स्क्रीन और navigation समझ लेते हैं।",
        "सबसे पहले login। अपनी कंपनी का ईमेल और पासवर्ड डालकर Sign in दबाएँ। हर organization का login अलग होता है — एक कंपनी का यूज़र दूसरी कंपनी की बुक्स नहीं देख सकता। साझा कंप्यूटर पर काम के बाद ऊपर avatar से sign out ज़रूर करें।",
        "login होते ही Dashboard खुलता है — यह आपका रोज़ का cockpit है। ऊपर quick actions: New Sales Invoice, New Purchase, Jobwork Inward, Record Payment और Tally Export। नीचे सात KPI कार्ड्स — इस महीने की sales, purchase, receivables, payables, stock value और open jobwork। किसी भी कार्ड पर क्लिक करें, सीधे वही लिस्ट खुल जाती है।",
        "काम तेज़ करने के लिए कहीं से भी Ctrl+K दबाएँ — command palette। यहाँ party का नाम, item का कोड या invoice नंबर टाइप करें। नतीजे तीन तरह के आते हैं: create actions, recent screens और live search। किसी नतीजे पर Enter दबाएँ, सीधे वही रिकॉर्ड खुल जाएगा।",
        "keyboard shortcuts याद रखें। सवालिया निशान दबाने पर पूरी लिस्ट आ जाती है। Alt+S से कहीं से भी नया sales invoice और Alt+P से purchase bill बनता है। g दबाकर फिर s मतलब सीधे Sales, j मतलब Jobwork, r मतलब Reports। Esc से कोई भी dialog बंद हो जाता है।",
        "फ़ोन पर भी पूरा ERP चलता है — वही URL, कोई अलग app नहीं। छोटी स्क्रीन पर नीचे tab bar आ जाता है: Home, Sales, Purchase, Jobwork और Stock। ऊपर बाईं तरफ़ menu icon से पूरा sidebar drawer में खुल जाता है, हर module वहीं मिलेगा।",
    ],
    "02-masters-setup": [
        "Chapter दो — पहला setup। नए सिस्टम पर पहले यही क्रम फ़ॉलो करें: company profile, parties, items, warehouses, processes और फिर opening stock। क्रम ग़लत हुआ तो transaction फेल होगी — party बने बिना invoice नहीं बन सकती।",
        "Masters में Company टैब खोलें। Trade name, GSTIN, state, पता और bank details भरें — यही चीज़ें हर invoice पर छपती हैं। GSTIN का आख़िरी अक्षर checksum होता है, ग़लत हुआ तो app साफ़ मना कर देगा।",
        "Parties में New Party दबाएँ। कोड और नाम ज़रूरी हैं। Types में CUSTOMER, SUPPLIER या JOBWORKER — एक साथ कई भी चुन सकते हैं। GSTIN, state और छह अंकों का pincode डालें, यह e-Invoice के लिए ज़रूरी है। Credit limit और credit days से उधार और aging रिपोर्ट चलती है।",
        "किसी party पर eye icon दबाएँ तो पूरा view खुलता है — receivable, payable और voucher history। वहीं से एक क्लिक में New Invoice, Receive Payment या Party Ledger खुल जाता है।",
        "Items में कोड और नाम के साथ group, HSN, UOM, GST प्रतिशत, sale rate और reorder level भरें। HSN छह या आठ अंकों का रखें, चार अंक वाला e-Invoice में रिजेक्ट होता है। reorder level के नीचे stock जाते ही dashboard पर low stock alert आता है।",
        "Warehouses दो रखें: MAIN आपका अपना स्टॉक और JW कस्टमर का jobwork माल। दोनों अलग रहते हैं, इसलिए आपकी valuation में कस्टमर का माल नहीं गिनता। Availability हमेशा चुने हुए warehouse में ही चेक होती है।",
        "Processes में हर प्रोसेस का rate तीन आधार पर है — per KG, per piece और per lot। Lot charge अलग से जुड़ता है। Party Rates में किसी एक पार्टी के लिए rate override कर सकते हैं।",
    ],
    "03-sales-gst-invoice": [
        "Chapter तीन — Sales और GST invoice। यह सबसे ज़्यादा इस्तेमाल होने वाला हिस्सा है। एक ही transaction में तीन चीज़ें बनती हैं: invoice, स्टॉक लेजर और double-entry GL। आधा-अधूरा रिकॉर्ड कभी नहीं बचता।",
        "Sales लिस्ट में हर invoice के साथ grand total, paid और balance दिखता है, और source — MANUAL या JOBWORK। ऊपर filter chips से सिर्फ़ unpaid या paid invoices छाँट सकते हैं।",
        "New Invoice दबाएँ। Customer चुनें — place of supply उसके state से अपने आप सेट हो जाता है। Date और stock from warehouse चुनें। लाइन में item, qty और rate डालें, discount भी दे सकते हैं। अगर आपके rate में GST पहले से शामिल है तो tax-inclusive switch ऑन कर दें, app पीछे से निकाल लेगा। नीचे live GST preview दिखता है — report, print और posted totals एक जैसे रहते हैं। Post Invoice दबाएँ, नंबर अपने आप बन जाएगा।",
        "किसी invoice पर क्लिक करें। ऊपर actions मिलते हैं: Receive Payment, Duplicate, Tally, Print और Cancel। Cancel करने पर स्टॉक और GL दोनों उलट जाते हैं, delete कुछ नहीं होता। नीचे पूरा tax invoice मिलता है — HSN, amount in words और bank details के साथ।",
        "Tally dropdown से एक क्लिक में XML, JSON या CSV मिल जाता है, और importer की .bat फ़ाइल भी। e-Invoice JSON सीधे GST portal के bulk upload के लिए बनता है। JSON बनने से पहले validation चलती है — buyer GSTIN, छह अंकों का pincode और HSN चेक होते हैं।",
        "बड़े ऑर्डर के लिए Quote to Cash टैब: पहले sales quotation, फिर sales order, फिर delivery challan QC के साथ, और आख़िर में invoice। Quantity हर स्टेप आगे कैरी होती है, इसलिए दोहरी एंट्री नहीं होती।",
    ],
    "04-purchase-procurement": [
        "Chapter चार — Purchase और Procurement। Supplier bill post करते ही स्टॉक अंदर आता है और input GST लेजर में जाता है। एंट्री बनती है: Dr Purchase और Dr Input GST, Cr Supplier।",
        "Purchase लिस्ट में PIN series, supplier, grand total और बकाया दिखता है। आधे पैसे दिए हों तो status partial paid दिखाता है।",
        "New Purchase दबाएँ या कहीं से Alt+P। Supplier चुनें, उसका bill number और date डालें। State से CGST और SGST या IGST अपने आप तय हो जाता है। लाइन में item, qty और rate भरकर post करें — स्टॉक weighted-average cost पर अंदर आ जाता है।",
        "बड़ी खरीद के लिए Procurement टैब: पहले requisition, फिर कई suppliers से RFQ और side-by-side comparison, फिर purchase order। माल आने पर GRN बनता है और QC पास होने के बाद ही स्टॉक लेजर में असली receipt आती है। Three-way match, PO, GRN और bill को मिलाकर mismatch पकड़ता है।",
        "Back Orders रिपोर्ट बताती है कि कौन-सा ऑर्डर लिया है पर माल नहीं है — यहीं से purchase का फ़ैसला या delivery reschedule करें।",
    ],
    "05-customer-jobwork": [
        "Chapter पाँच — Customer Jobwork। यह इस सॉफ़्टवेयर की सबसे ख़ास चेन है। कस्टमर कच्चा माल देता है, आप प्रोसेस करते हैं, certificate देते हैं और सर्विस का GST invoice बनाते हैं। कस्टमर का माल value-neutral रहता है, आपकी valuation में नहीं गिनता।",
        "Customer Jobwork में Inwards लिस्ट है — JWI नंबर, party, items और batch। हर inward पर progress bar दिखता है कि कितना प्रोसेस हुआ। Status OPEN से COMPLETED और फिर INVOICED होता है।",
        "Pending टैब एक नज़र में बताता है कि किस item का कितना माल आया, कितना प्रोसेस हुआ और कितना बाकी है, साथ में pending processes।",
        "जिस inward पर काम करना है उसे खोलें और New Job Card दबाएँ। जो items प्रोसेस करने हैं उन्हें tick करें, qty और weight बदल सकते हैं — partial processing allowed है। फिर प्रोसेस चुनें; rate party rate से आता है, वरना process default से। नीचे live estimate दिखता है, और server पाँच प्रतिशत tolerance से ऊपर प्रोसेसिंग रोक देता है।",
        "पूरा काम होने पर Issue Certificate दबाएँ। CERT नंबर बन जाता है — यही काम का सबूत है। इसके बाद Generate Invoice एक्टिव हो जाता है।",
        "अब Generate Invoice दबाएँ। प्रोसेस-वाइज़ सर्विस लाइनें, GST अठारह प्रतिशत और SAC 998887 के साथ invoice बन जाती है, और Sales लिस्ट में JOBWORK source के साथ दिखती है। इसके बाद उस inward पर नए job cards बंद हो जाते हैं — नया काम आए तो नया inward बनाएँ।",
    ],
    "06-manufacturing": [
        "Chapter छह — Own Projects और Manufacturing। यहाँ आपका अपना माल बनता है, कस्टमर का नहीं। चेन है: project, BOM, work order, operation tasks और FG receipt। Sidebar में module के नीचे groups खुद खुल जाते हैं — Plan, Shop floor, Setup और Analyse।",
        "Projects टैब में KPI कार्ड्स हैं: running projects, open work orders, unassigned tasks, WIP और completed। नीचे हर project की लिस्ट, जिससे आगे का पूरा काम जुड़ता है।",
        "Plan में BOMs खोलें और New BOM दबाएँ। Output item चुनें, यानी जो बनेगा, और raw material की qty per unit wastage के साथ डालें। Labour cost और standard minutes भरें, costing इसी पर चलेगी। Approve करने के बाद revision लॉक हो जाता है; बदलाव चाहिए तो Revise दबाएँ, नया revision बनेगा।",
        "MRP टैब में as-of date और horizon डालकर Run MRP दबाएँ। यह sales orders और work orders की demand को BOM से explode करता है, फिर स्टॉक, open work orders और approved PO से net करता है। नतीजा suggestion होता है — BUY या MAKE। जब तक आप approve नहीं करते, कुछ भी ख़रीदा या बनाया नहीं जाता।",
        "Work Orders में priority, schedule, lines और task progress दिखता है। Material और labour post होते-होते cost भी जुड़ती जाती है।",
        "Capacity टैब हर work centre का shift calendar, parallel capacity और route sequence के हिसाब से load दिखाता है। Utilisation सौ प्रतिशत से ऊपर है तो मतलब काम horizon में फ़िट नहीं हो रहा।",
        "OEE तीन चीज़ों का गुणा है: availability, performance और quality। Number देखने से पहले ऊपर लिखा caveat box पढ़ें — अगर उस हफ़्ते कोई operation पूरा नहीं हुआ तो performance और quality शून्य आते हैं।",
        "Costing में हर work order पर तीन बाल्टी अलग रहती हैं: material, labour और overhead। Standard BOM approval के समय फ़्रीज़ होता है और actual फ़्लोर से आता है — दोनों का variance यहीं दिखता है। Overhead प्रतिशत policy switch है, accountant से पुष्टि के बाद ही बदलें।",
    ],
    "07-inventory-accounting": [
        "Chapter सात — Inventory और Accounting। स्टॉक लेजर नियम पर चलता है: कोई कॉलम सीधे एडिट नहीं होता। हर एंट्री किसी voucher से आती है और cancel होने पर mirror-reverse होती है। Valuation weighted-average cost पर होती है।",
        "Stock Summary में item-wise in, out, closing quantity, average cost और closing value दिखती है। यह total dashboard के stock value से मिलता है।",
        "Stock Ledger हर मूवमेंट दिखाता है — opening, purchase, sales, jobwork-in और adjustment, running balance और value के साथ।",
        "Lots और Serials में batch-wise स्टॉक, serial numbers और genealogy मिलती है — किस lot से क्या बना।",
        "Physical count में फ़र्क़ आए तो Adjustments में reason के साथ post करें — damage, scrap या shortage। History बनी रहती है, इसलिए audit में सवाल नहीं उठता।",
        "Accounting में New Payment खोलें। Type चुनें — RECEIPT मतलब कस्टमर से पैसा आया, या PAYMENT मतलब सप्लायर को दिया। Party, amount, mode और reference भरें। Allocation में बताएँ किस invoice का पैसा है — बचा हुआ amount advance बन जाता है और बाद में किसी भी invoice पर लग सकता है।",
        "Party Ledger में opening, total debit, total credit और closing दिखता है, और नीचे हर voucher running balance के साथ। यहीं से पता चलता है कि कितना बकाया है और किस दस्तावेज़ से।",
        "Chart of Accounts में पंद्रह खातों का ढाँचा है — debtors, creditors, sales, purchase, GST, WIP और overhead। Journal voucher में Dr और Cr बराबर न हों तो Post बटन बंद रहता है।",
    ],
    "08-reports-gst-tally": [
        "Chapter आठ — Reports, GST, Tally और Audit Trail। सारी रिपोर्ट append-only लेजर से बनती हैं, इसलिए trial balance हमेशा balanced आता है।",
        "Reports में सबसे पहले Action Center खोलें। यह बताता है आज क्या ज़रूरी है — overdue receivables, pending tasks, low stock और unbilled jobwork, सब एक जगह।",
        "GSTR-1 में महीना चुनकर Run दबाएँ। B2B rate-wise summary और B2C का split मिल जाता है। ध्यान रहे, सिर्फ़ posted sales गिनती में आती हैं।",
        "GSTR-3B books summary output tax, purchase tax और net position दिखाती है — CGST, SGST और IGST अलग-अलग। यह books working है, फाइल्ड रिटर्न नहीं — CA से वेरिफ़ाई करके ही अपलोड करें।",
        "Trial Balance में अगर Dr बराबर Cr का हरा बैनर दिखे तो बुक्स ठीक हैं। कहीं फ़र्क़ हो तो वहीं नज़र आ जाएगा।",
        "Outstanding में कस्टमर के receivables और सप्लायर के payables invoice-level breakup के साथ दिखते हैं। Aging बताती है पैसा कितने दिन से बाकी है — follow-up की प्राथमिकता यहीं तय करें।",
        "P&L में revenue, यानी sales और jobwork income, से purchases घटाकर round-off के बाद net profit या loss आता है। महीने-दर-महीने तुलना करें।",
        "Tally Export में पहले masters XML डाउनलोड करें, फिर vouchers। Bulk export में range चुनें और सब एक फ़ाइल में मिल जाएगा। हर voucher पर REMOTEID होता है, इसलिए वही फ़ाइल दोबारा import करने पर duplicate नहीं बनता — update होता है।",
        "Audit Trail append-only है — किसने, कब, क्या बनाया, बदला, कैंसल किया या export किया, सब दर्ज है। Filter करके CSV export करें और auditor को दे दें।",
        "बस इतना ही! रोज़ सुबह dashboard देखें, रोज़ शाम को invoices और payments post करें। हफ़्ते में एक बार outstanding, certificates और pending tasks। महीने के अंत में GSTR-1 और 3B, फिर Tally export और audit CSV। ForgeERP आपका धंधा साफ़ और तेज़ रखेगा। धन्यवाद!",
    ],
}


def chapter_speech(slug: str) -> str:
    return " ".join(NARRATION[slug])
