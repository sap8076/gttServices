const cds = require("@sap/cds");
const axios = require("axios");
const { header, param } = require("express/lib/request");
module.exports = cds.service.impl(async function () {
    const {
        trackingDetails,
        trackingItems,
        unplannedEvents,
        reasonCodes
    } = this.entities;
    this.on('READ', trackingDetails, getTrackingDetails);
    this.on('READ', trackingItems, getTrackingItems);
    this.on('READ', unplannedEvents, getunplannedEvents);
    this.on('READ', reasonCodes, getreasonCodes);
    this.on('UPDATE', trackingDetails, updateStatus);
    this.on("updateStatus", updateStatus);
    this.on("updateDelivery", updateDelivery);
})

const tracking  = 6300001454

const getTrackingDetails = async (req, res) => {

    try {
       
       
        const GTTapi = await cds.connect.to('GTTdest');
        //let gttAPI = "/outbound/odata/v1/com.navgtt014vifgdob.gtt.app.gttft1.gttft1Service" + '/Shipment?$filter=req.query.SELECT.where[2].val eq ' + "'" + req.query.SELECT.where[2].val + "'";
        let expand  =  '&$expand=stops,freightUnitTPs,freightUnitTPs/freightUnit,freightUnitTPs/freightUnit/freightUnitItems,plannedEvents'
        let gttAPI = `/outbound/odata/v1/com.navgtt014vifgdob.gtt.app.gttft1.gttft1Service/Shipment?$filter=trackingId eq '${req.query.SELECT.where[2].val}'${expand}&$format=json`;
        
        const res = await GTTapi.send({
            method: 'GET',
            path: gttAPI,
            headers: {
                "Content-Type": "application/json",
            },
           
        });
        console.log("res",res)
        const itemDest = await cds.connect.to('S4HANA');
        let s4items = `/itemDataSet?$filter=FoId eq '${req.query.SELECT.where[2].val}'&$format=json`;
        let itemRes = await itemDest.send({
            method: 'GET',
            path: s4items,
            headers: {
                "Content-Type": "application/json",
            },
           

        });
        
        console.log("s4items",itemRes)
        const trackingDetails = [];
        const depart = 'com.navgtt014vifgdob.gtt.app.gttft1.Shipment.Departure';
        const arrive = 'com.navgtt014vifgdob.gtt.app.gttft1.Shipment.Arrival';
        const pod = 'com.navgtt014vifgdob.gtt.app.gttft1.Shipment.POD';
        const eventReported = 'REPORTED';
        const eventLateReported = 'LATE_REPORTED';
        const eventEarlyReported = 'EARLY_REPORTED';
      
         
        for (let i = 0; i < res[0].stops.length; i++) {
            let lbnAPI = `/location/v1/Location?$filter=externalId eq '${res[0].stops[i].locationId}'&$format=json`;
    
            try {
                // Fetch location data
                const reslbn = await GTTapi.send({
                    method: 'GET',
                    path: lbnAPI,
                    headers: {
                        "Content-Type": "application/json",
                    },
                });
    
                if (reslbn.length === 0) {
                    console.warn(`No data found for locationId: ${res[0].stops[i].locationId}`);
                    continue;  // Skip to the next iteration if no data is found
                }
    
                let resobj = {};
                let locationData = reslbn[0];
                let plannedEvent = res[0].plannedEvents.filter(obj => obj.locationAltKey === locationData.locationAltKey);
    
                // Check for the departure status
                if (plannedEvent.some(obj => obj.eventType === depart && 
                    [eventReported, eventEarlyReported, eventLateReported].includes(obj.eventStatus_code))) {
                    resobj.isDeparted = 'X';
                }
    
                // Check for the arrival status and set planned departure time
                let plannedArrive = plannedEvent.filter(obj => obj.eventType === arrive);
                if (plannedArrive.length > 0) {
                    resobj.plannedDepTime = (new Date(parseInt(plannedArrive[0].plannedBusinessTimestamp.match(/(\d+)/)[0])).toLocaleString('en-UK', { timeZone: plannedArrive[0].plannedBusinessTimeZone })) + ' ' + plannedArrive[0].plannedBusinessTimeZone;
                    resobj.timeZone = plannedArrive[0].plannedBusinessTimeZone;
                    if (plannedEvent.some(obj => [eventReported, eventEarlyReported, eventLateReported].includes(obj.eventStatus_code))) {
                        resobj.isArrived = 'X';
                    }
                }
    
                // Check for the delivery status
                if (plannedEvent.some(obj => obj.eventType === pod && 
                    [eventReported, eventEarlyReported, eventLateReported].includes(obj.eventStatus_code))) {
                    resobj.isDelivered = 'X';
                }
    
                // Populate resobj with basic information
                resobj.shipmentNo = res[0].shipmentNo;
                resobj.altKey = res[0].altKey;
                resobj.locationId = res[0].stops[i].locationId;
                resobj.ordinalNo = res[0].stops[i].ordinalNo;
                resobj.stopId = res[0].stops[i].stopId;
                resobj.locationDescription = locationData.locationDescription;
                resobj.addressDetail = locationData.addressDetail;
                resobj.longitude = locationData.longitude;
                resobj.latitude = locationData.latitude;
                resobj.locationAltKey = locationData.locationAltKey;
                resobj.materialLoad = '10';
                resobj.materialUnload = '0';
                resobj.plannedDistance = res[0].plannedTotalDistance;
                resobj.plannedDistanceUom = res[0].plannedTotalDistanceUoM;
    
                // For the first stop, set additional fields
                if (i === 0) {
                    resobj.isArrived = 'X';
                    resobj.isDelivered = 'X';
                    resobj.plannedDepTime = new Date(parseInt(res[0].plannedDepartureDateTime.match(/(\d+)/)[0])).toLocaleString('en-UK', { timeZone: res[0].plannedDepartureDateTimeZone }) + ' ' + res[0].plannedDepartureDateTimeZone;
                    resobj.timeZone = res[0].plannedDepartureDateTimeZone;
                    resobj.materialLoad = res[0].cargoQuantity + res[0].quantityUoM;
                }
    
                // Collect items for this stop
                let aItems = [];
                for (let j = 0; j < itemRes.length; j++) {
                    if (itemRes[j].LocationId === resobj.locationId) {
                        aItems.push({
                            ordinalNo: res[0].stops[i].ordinalNo,
                            itemNo: itemRes[j].ItemNo,
                            productId: itemRes[j].ProductId,
                            itemDesc: itemRes[j].ItemDescr,
                            dispQty: itemRes[j].ActQty,
                            rcvQty: itemRes[j].ActQty,
                            uom: itemRes[j].Unit,
                            category: itemRes[j].ItemCat,
                        });
                    }
                }
                resobj.Items = aItems;
    
                trackingDetails.push(resobj);
    
                console.log("------------------tracking details", JSON.stringify(trackingDetails));
    
            } catch (error) {
                console.error(`Failed to fetch location for locationId: ${res[0].stops[i].locationId}`, error);
            }
        }
    
        // Return all collected tracking details
        return trackingDetails;
    
    }
    catch (error) {

        return {
            apiResponse: error?.message
        };
    }
}


const getTrackingItems = async (req, res) => {
    try {
       
        const itemDest = await cds.connect.to('S4HANA');
        //let s4items ="/itemDataSet?$filter=FoId eq '6300001284'&$format=json"
        let s4items = `/itemDataSet?$filter=FoId eq '${req.query.SELECT.where[2].val}'&locationId eq '${req.query.SELECT.where[6].val}&$format=json`;
        const itemRes = await itemDest.send({
            method: 'GET',
            path: s4items,

            headers: {
                "Content-Type": "application/json",
            },
           

        });
        //console.log("asdfasdfas",itemRes)
        let trackingItems = [];
        for (j = 0; j < itemRes.length; j++) {
            let items = {};
            items.FoId == itemRes[j].FoId
            items.locationId == itemRes[j].locationId;
            items.itemNo = itemRes[j].ItemNo;
            items.productId = itemRes[j].ProductId;
            items.itemDesc = itemRes[j].ItemDescr;
            items.dispQty = itemRes[j].ActQty;
            items.rcvQty = itemRes[j].ActQty;
            items.uom = itemRes[j].Unit;
            items.category = itemRes[j].ItemCat;
            trackingItems.push(items);
        }
        console.log("---------------trackingItems----------",trackingItems)
        return trackingItems;
    }
    catch (error) {
        return {
            apiResponse: error?.message
        };
    }
}
const getunplannedEvents = async (req, res) => {
    
    let unplannedEvents = [];
    let unplannedEvent = {};
    unplannedEvent.eventCode = 'LocationUpdate';
    unplannedEvent.eventName = 'Location Update';
    unplannedEvents.push(unplannedEvent);
    unplannedEvent = {};
    unplannedEvent.eventCode = 'Delay';
    unplannedEvent.eventName = 'Delay';
    unplannedEvents.push(unplannedEvent);
    unplannedEvent = {};
    unplannedEvent.eventCode = 'POD';
    unplannedEvent.eventName = 'Proof of Delivery';
    unplannedEvents.push(unplannedEvent);
    unplannedEvent = {};
    unplannedEvent.eventCode = 'Handover';
    unplannedEvent.eventName = 'Handover';
    unplannedEvents.push(unplannedEvent);
    unplannedEvent = {};
    unplannedEvent.eventCode = 'Return';
    unplannedEvent.eventName = 'Return';
    unplannedEvents.push(unplannedEvent);
    unplannedEvent = {};
    unplannedEvent.eventCode = 'OtherEvent';
    unplannedEvent.eventName = 'Other';
    unplannedEvents.push(unplannedEvent);
    unplannedEvent = {};
    console.log("----------------------uplannedEvent-----------------------------",unplannedEvents)
    return unplannedEvents;
}
const getreasonCodes = async (req, res) => {
    try {
        const GTTapi = await cds.connect.to('GTTdest');
        let gttAPI = + '/EventReasonCode';
        const res = await GTTapi.send({
            method: 'GET',
            path: gttAPI,

            headers: {
                "Content-Type": "application/json",
            },
           

        });
        console.log("==================getresoncode============",res)
        let reasonCodes = [];
        for (i = 0; i < res.length; i++) {
            let reasonCode = {};
            reasonCode.code = res[i].code;
            reasonCode.name = res[i].name;
            reasonCodes.push(reasonCode);
        }
        return reasonCodes;
    }
    catch (error) {
        return {
            apiResponse: error?.message
        };
    }
}
const updateStatus = async (req, res) => {
    if (req.data.eventName)
        var eventName = (req.data.eventName).trim();
    try {
        if (req.data.eventName)
            var eventName = (req.data.eventName).trim();
        //gttAPI = process.env.eventURL + '/' + eventName;
        let gttAPI = `/inbound/rest/v1/com.navgtt014vifgdob.gtt.app.gttft1.gttft1WriteService/${eventName}`
        let postData = {};
        if (req.data.signature || req.data.podImage) {
            if (req.data.signature && req.data.podImage)
                postData = {
                    altKey: req.data.altKey,
                    eventMatchKey: req.data.stopId,
                    //quantity: req.data.quantity,
                    actualTechnicalTimestamp: req.data.eventTime,
                    actualBusinessTimeZone: req.data.timeZone,
                    actualBusinessTimestamp: req.data.eventTime,
                    locationAltKey: req.data.locationAltKey,
                    longitude: parseFloat((req.data.eventLong).toFixed(9)),
                    latitude: parseFloat((req.data.eventLat).toFixed(9)),
                    attachments: [
                        {
                            fileName: "Signature.PNG",
                            fileContentBase64: req.data.signature
                        },
                        {
                            fileName: "POD.JPEG",
                            fileContentBase64: req.data.podImage
                        }
                    ]
                };
            else if (req.data.signature)
                postData = {
                    altKey: req.data.altKey,
                    eventMatchKey: req.data.stopId,
                    //quantity: req.data.quantity,
                    actualTechnicalTimestamp: req.data.eventTime,
                    actualBusinessTimeZone: req.data.timeZone,
                    actualBusinessTimestamp: req.data.eventTime,
                    locationAltKey: req.data.locationAltKey,
                    longitude: parseFloat((req.data.eventLong).toFixed(9)),
                    latitude: parseFloat((req.data.eventLat).toFixed(9)),
                    attachments: [
                        {
                            fileName: "Signature.PNG",
                            fileContentBase64: req.data.signature
                        }
                    ]
                };
            else if (req.data.podImage)
                postData = {
                    altKey: req.data.altKey,
                    //quantity: req.data.quantity,
                    eventMatchKey: req.data.stopId,
                    actualTechnicalTimestamp: req.data.eventTime,
                    actualBusinessTimeZone: req.data.timeZone,
                    actualBusinessTimestamp: req.data.eventTime,
                    locationAltKey: req.data.locationAltKey,
                    longitude: parseFloat((req.data.eventLong).toFixed(9)),
                    latitude: parseFloat((req.data.eventLat).toFixed(9)),
                    attachments: [

                        {
                            fileName: "POD.JPEG",
                            fileContentBase64: req.data.podImage
                        }
                    ]
                };
            console.log(postData)
            
        const GTTapi = await cds.connect.to('GTTdest');
        //let gttAPI = "/outbound/odata/v1/com.navgtt014vifgdob.gtt.app.gttft1.gttft1Service" + '/Shipment?$filter=req.query.SELECT.where[2].val eq ' + "'" + req.query.SELECT.where[2].val + "'";
       ;
        
        const res = await GTTapi.send({
            method: 'POST',
            path: gttAPI,
            data: postData,
            headers: {
                "Content-Type": "application/json",
            },
           
        });
       
        }
        else if (req.data.reasonCode) {
            postData = {
                altKey: req.data.altKey,
                eventMatchKey: req.data.stopId,
                actualTechnicalTimestamp: req.data.eventTime,
                actualBusinessTimeZone: req.data.timeZone,
                actualBusinessTimestamp: req.data.eventTime,
                reasonCode_code: req.data.reasonCode,
                locationAltKey: req.data.locationAltKey,
                longitude: parseFloat((req.data.eventLong).toFixed(9)),
                latitude: parseFloat((req.data.eventLat).toFixed(9)),
            }
        }
        else {
            postData = {
                altKey: req.data.altKey,
                eventMatchKey: req.data.stopId,
                actualTechnicalTimestamp: req.data.eventTime,
                actualBusinessTimeZone: req.data.timeZone,
                actualBusinessTimestamp: req.data.eventTime,
                locationAltKey: req.data.locationAltKey,
                longitude: parseFloat((req.data.eventLong).toFixed(9)),
                latitude: parseFloat((req.data.eventLat).toFixed(9)),
            }
            const res = await GTTapi.send({
                method: 'POST',
                path: gttAPI,
                data: postData,
                headers: {
                    "Content-Type": "application/json",
                },
               
            });
        }
        let strMsg = 'Event - ' + eventName + ' posted scuccessfully!';
        return { status: strMsg };
    } catch (err) {
        console.log("error - " + err);
        req.error(404, err.message);
    }
}
const updateDelivery = async (req, res) => {
    try {
        let postData = JSON.stringify({
            "FoId": req.data.FoId,
            "LocationId": req.data.LocationId,
            "ItemNo": req.data.ItemNo,
            "ProductId": req.data.ProductId,
            "ActQty": req.data.ActQty
        });
        let headers = {
            'Content-Type': 'application/json'
        };
        const s4service = await cds.connect.to('S4HANA');
        const response = s4service.send({
            method: 'POST',
            path: '/itemDataSet',
            data: postData,
            headers: headers
        });
        let strMsg = 'Update successfully!';
        return { status: strMsg, response };
    } catch (err) {
        console.log("error - " + err);
        req.error(404, err.message);
    }
}