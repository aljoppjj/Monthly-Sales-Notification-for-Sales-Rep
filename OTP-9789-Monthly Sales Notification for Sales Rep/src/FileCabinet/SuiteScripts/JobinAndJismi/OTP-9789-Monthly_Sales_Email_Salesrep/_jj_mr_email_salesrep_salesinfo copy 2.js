/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
 
/*********************************************************************************
 * OTP-9789: Monthly Sales Notification for Sales Rep
 *
 * Author: Jobin & Jismi IT Services
 *
 * Date: 31-October-2025
 * 
 * Description: Send monthly email to sales reps with CSV of last month's sales.
 *              If no sales rep assigned, send to admin.
 *
 * REVISION HISTORY
 *
 * @version 1.0 : 31-October-2025 : Initial build created by JJ0417
 * @version 1.1 : 12-November-2025 : Fixed customer email and sales rep issues
 *
 *********************************************************************************/

define(['N/email', 'N/file', 'N/log', 'N/search'],
    function (email, file, log, search) {

        /**
         * Retrieves all sales transactions for the previous month
         * @returns {Search} NetSuite search object containing sales transactions
         */
        function getInputData() {
            try {
                log.audit('Script Started', 'Monthly Sales Notification');

                return search.create({
                    type: search.Type.SALES_ORDER,
                    filters: [
                        ['trandate', 'within', 'lastmonth'],
                        'AND',
                        ['mainline', 'is', 'T'],
                        'AND',
                        ['customer.isinactive', 'is', 'F']
                    ],
                    columns: [
                        { name: 'tranid' },
                        { name: 'entity' },
                        { name: 'email', join: 'customer' },
                        { name: 'amount' },
                        { name: 'salesrep' }
                    ]
                });

            } catch (e) {
                log.error('getInputData Error', e.message);
                throw e;
            }
        }

        /**
         * Processes each transaction and groups by sales rep
         * @param {Object} context - Map context object
         * @param {string} context.key - Transaction internal ID
         * @param {string} context.value - Transaction data as JSON string
         */
        function map(context) {
            try {
                const searchResult = JSON.parse(context.value);
                const data = searchResult.values;
                
                // Get sales rep from search results
                let salesRepId = 'Unassigned';
                let salesRepName = 'Unassigned';
                if (data.salesrep) {
                    salesRepId = data.salesrep.value || 'Unassigned';
                    salesRepName = data.salesrep.text || 'Unassigned';
                }
                
                // If no sales rep on SO, lookup from customer
                if (salesRepId === 'Unassigned' && data.entity && data.entity.value) {
                    const customerFields = search.lookupFields({
                        type: search.Type.CUSTOMER,
                        id: data.entity.value,
                        columns: ['salesrep']
                    });

                    if (customerFields.salesrep && customerFields.salesrep.length > 0) {
                        salesRepId = customerFields.salesrep[0].value;
                        salesRepName = customerFields.salesrep[0].text;
                    }
                }


                let customerEmail = 'No Email';
                let customerName = 'Unknown';
                if (soFields.entity && soFields.entity.length > 0) {
                    const customerId = soFields.entity[0].value;
                    customerName = soFields.entity[0].text;
                    
                    const customerFields = search.lookupFields({
                        type: search.Type.CUSTOMER,
                        id: customerId,
                        columns: ['email']
                    });
                    
                    if (customerFields.email) {
                        customerEmail = customerFields.email;
                    }
                }
                
                const docNumber = data.tranid || 'Null';
                const amount = data.amount || '0.00';
                const csvLine = `${customerName},${customerEmail},${docNumber},${amount}`;
                
                log.debug('Map Processing', `SalesRep: ${salesRepName} (${salesRepId}), Customer: ${customerName}, Email: ${customerEmail}`);
                
                context.write({ key: salesRepId, value: csvLine });

            } catch (e) {
                log.error('Map Error', e.message);
            }
        }

        /**
         * Creates CSV file and sends email to sales rep or admin
         * @param {Object} context - Reduce context object
         * @param {string} context.key - Sales rep internal ID or 'Unassigned'
         * @param {Array} context.values - Array of CSV lines for this sales rep
         */
        function reduce(context) {
            try {
                const salesRepId = context.key;
                const allLines = context.values;

                const today = new Date();
                const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1);
                const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                const monthName = monthNames[lastMonth.getMonth()];

                const csvContent = 'Customer Name,Customer Email,Sales Order Document Number,Sales Amount\n' + allLines.join('\n');

                const csvFile = file.create({
                    name: `Sales_Report_${salesRepId}_${monthName}.csv`,
                    fileType: file.Type.CSV,
                    contents: csvContent,
                    folder: 1227
                });
                
                const fileId = csvFile.save();

                const isUnassigned = salesRepId === 'Unassigned';
                const recipient = isUnassigned ? -5 : salesRepId;
                const subject = isUnassigned ? `Unassigned Sales Rep` : `Your Sales Report - ${monthName}`;
                const body = isUnassigned 
                    ? 'Please assign sales reps to these customers.\n\nSee attached CSV.\n\nThank you.'
                    : `Your monthly sales report for ${monthName} is attached.\n\nThank you.`;

                try {
                    email.send({
                        author: -5,
                        recipients: recipient,
                        subject: subject,
                        body: body,
                        attachments: [file.load({ id: fileId })]
                    });
                    log.audit('Email Sent', isUnassigned ? 'To admin' : `To sales rep ${salesRepId}`);
                } catch (e) {
                    log.audit('Email Skipped', `Sales rep ${salesRepId} has no email or cannot receive messages.`);
                }

            } catch (e) {
                log.error('Reduce Error', `${context.key}: ${e.message}`);
            }
        }

        /**
         * Summarizes the script execution
         * @param {Object} summary - Summary context object
         */
        function summarize(summary) {
            log.audit('Script Completed', 'Map/Reduce finished successfully.');
        }

        return {
            getInputData: getInputData,
            map: map,
            reduce: reduce,
            summarize: summarize
        };
    });