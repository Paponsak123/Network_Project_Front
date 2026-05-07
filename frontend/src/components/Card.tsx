interface Device {
  _id?: string;
  customName?: string;
  vendor?: string;
  ip: string;
  mac: string;
  status: string;
}

interface DeviceCardProps {
  device: Device;
}

export default function Card({ device }: DeviceCardProps) {
  return (
    <div className="p-4 border rounded-lg shadow-sm bg-white dark:bg-zinc-900 text-black dark:text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <p className="font-medium text-lg mb-1">
          {device.customName || device.vendor || "Unknown Device"}
        </p>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-6 text-sm text-gray-600 dark:text-gray-400">
          <p>
            <span className="font-semibold text-gray-700 dark:text-gray-300">IP:</span>{" "}
            {device.ip}
          </p>
          <p>
            <span className="font-semibold text-gray-700 dark:text-gray-300">MAC:</span>{" "}
            {device.mac}
          </p>
        </div>
      </div>
      <div className="flex-shrink-0">
        <span
          className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${
            device.status === "online"
              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
              : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
          }`}
        >
          {device.status === "online" ? "🟢 Online" : "🔴 Offline"}
        </span>
      </div>
    </div>
  );
}
