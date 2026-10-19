import board from './definitions/board.json';
import led from './definitions/led.json';
import potentiometer from './definitions/potentiometer.json';
import pushButton from './definitions/push-button.json';
import resistor from './definitions/resistor.json';
import servo from './definitions/servo.json';
import ybcBoard from './definitions/ybc-board.json';

// Only the app bootstrap (and tests) should import this; everything else
// receives a DeviceRegistry so the source can later become an API/CMS.
export const localDeviceDefinitions: readonly unknown[] = [board, led, resistor, pushButton, ybcBoard, potentiometer, servo];
