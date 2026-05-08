module counter (
    input clk,
    input rstn,
    output reg [4:0] count
);

always @(posedge clk or negedge rstn) begin
    if (!rstn)
        count <= 5'd0;
    else
        count <= count + 1'b1;
end

endmodule